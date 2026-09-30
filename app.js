const $ = (id) => document.getElementById(id);
const LK = window.LivekitClient;

let liveRoom = null;
let currentCode = '';
let sharing = false;

function roomCode() {
  return 'MTR-' + Math.random().toString(36).slice(2, 7).toUpperCase();
}

function normalizeRoom(value) {
  return value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '')
    .slice(0, 32);
}

function setMessage(text, inRoom = false) {
  const element = $(inRoom ? 'roomMsg' : 'msg');
  if (element) element.textContent = text || '';
}

/* =========================
   ENTRAR / CRIAR SALA
========================= */

async function enter(create) {
  const name = $('name').value.trim();
  let code = normalizeRoom($('roomCode').value);

  if (!name) {
    return setMessage('Coloque seu nome para continuar.');
  }

  if (create && !code) {
    code = roomCode();
  }

  if (!code) {
    return setMessage('Digite o código da sala.');
  }

  setMessage('Conectando à MTR...');

  $('create').disabled = true;
  $('join').disabled = true;

  try {
    const response = await fetch('/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name,
        room: code
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data.error || 'Não foi possível entrar na sala.'
      );
    }

    liveRoom = new LK.Room({
      adaptiveStream: true,
      dynacast: true
    });

    bindRoomEvents(liveRoom);

    await liveRoom.connect(
      data.url,
      data.token
    );

    currentCode = data.room;

    localStorage.setItem(
      'mtrName',
      name
    );

    history.replaceState(
      {},
      '',
      `?room=${encodeURIComponent(currentCode)}`
    );

    $('roomCode').value = currentCode;

    $('roomTitle').textContent =
      `Sala ${currentCode}`;

    $('landing').classList.add('hidden');

    $('roomView').classList.remove('hidden');

    $('status').textContent = 'ONLINE';

    setMessage('');

    updatePeople();
    updateStage();

  } catch (err) {
    setMessage(
      err.message ||
      'Erro ao conectar à sala.'
    );

  } finally {
    $('create').disabled = false;
    $('join').disabled = false;
  }
}


/* =========================
   EVENTOS LIVEKIT
========================= */

function bindRoomEvents(room) {

  room.on(
    LK.RoomEvent.TrackSubscribed,
    (track, publication, participant) => {

      if (track.kind === LK.Track.Kind.Video) {
        attachVideo(
          track,
          participant
        );
      }

      updatePeople();
      updateStage();
    }
  );


  room.on(
    LK.RoomEvent.TrackUnsubscribed,
    (track) => {

      track
        .detach()
        .forEach((element) =>
          element.remove()
        );

      updateStage();
    }
  );


  room.on(
    LK.RoomEvent.ParticipantConnected,
    () => {
      updatePeople();
    }
  );


  room.on(
    LK.RoomEvent.ParticipantDisconnected,
    () => {
      updatePeople();
    }
  );


  room.on(
    LK.RoomEvent.LocalTrackPublished,
    (publication) => {

      if (
        publication.source ===
        LK.Track.Source.ScreenShare
      ) {

        const track =
          publication.track;

        if (track) {
          attachVideo(
            track,
            room.localParticipant,
            true
          );
        }
      }

      updateStage();
    }
  );


  room.on(
    LK.RoomEvent.LocalTrackUnpublished,
    (_, publication) => {

      if (
        publication?.source ===
        LK.Track.Source.ScreenShare
      ) {
        removeLocalPreview();
      }

      updateStage();
    }
  );


  room.on(
    LK.RoomEvent.Disconnected,
    () => {

      $('status').textContent =
        'OFFLINE';

      sharing = false;

      $('share').innerHTML =
        '🖥 Compartilhar tela';

      updateStage();
    }
  );
}


/* =========================
   VÍDEO
========================= */

function attachVideo(
  track,
  participant,
  local = false
) {

  const id =
    `video-${participant.identity}-${track.sid || 'screen'}`
      .replace(
        /[^a-zA-Z0-9_-]/g,
        ''
      );

  if ($(id)) return;

  const wrap =
    document.createElement('div');

  wrap.className = 'video-card';
  wrap.id = id;

  if (local) {
    wrap.dataset.localPreview = '1';
  }

  const video = track.attach();

  video.autoplay = true;
  video.playsInline = true;

  const volume = $('volume');

  if (volume) {
    video.volume =
      Number(volume.value) / 100;
  }

  const label =
    document.createElement('div');

  label.className =
    'video-label';

  label.textContent =
    `${participant.name || 'Participante'}${
      local ? ' • você' : ''
    }`;

  wrap.append(
    video,
    label
  );

  $('videos').appendChild(wrap);

  updateStage();
}


function removeLocalPreview() {
  document
    .querySelectorAll(
      '[data-local-preview="1"]'
    )
    .forEach(
      (element) =>
        element.remove()
    );
}


/* =========================
   PALCO
========================= */

function updateStage() {

  const hasVideo =
    $('videos').children.length > 0;

  $('emptyStage')
    .classList
    .toggle(
      'hidden',
      hasVideo
    );
}


/* =========================
   PESSOAS / VAGAS
========================= */

function updatePeople() {

  if (!liveRoom) return;

  const all = [
    liveRoom.localParticipant,
    ...liveRoom.remoteParticipants.values()
  ];

  const total = all.length;

  $('count').textContent =
    `👥 ${total}/6 assistindo`;

  if ($('sideCount')) {
    $('sideCount').textContent =
      `${total}/6`;
  }

  $('people').innerHTML = '';

  all.forEach((participant) => {

    const chip =
      document.createElement('span');

    if (
      participant ===
      liveRoom.localParticipant
    ) {

      chip.textContent =
        `${participant.name || 'Você'} • você`;

    } else {

      chip.textContent =
        participant.name ||
        'Participante';
    }

    $('people').appendChild(chip);
  });


  /* Atualiza as vagas vazias */

  const slots =
    document.querySelectorAll(
      '.empty-slot'
    );

  const empty =
    Math.max(
      0,
      6 - total
    );

  slots.forEach(
    (slot, index) => {

      slot.style.display =
        index < empty
          ? 'block'
          : 'none';
    }
  );
}


/* =========================
   CRIAR / ENTRAR
========================= */

$('create').onclick =
  () => enter(true);

$('join').onclick =
  () => enter(false);


/* =========================
   COMPARTILHAR TELA
========================= */

$('share').onclick =
  async () => {

    if (!liveRoom) return;

    setMessage('', true);

    try {

      sharing = !sharing;

      const fps =
        Number(
          $('fps')?.value || 30
        );

      const quality =
        $('quality')?.value || '720';

      const resolution =
        quality === '1080'
          ? {
              width: 1920,
              height: 1080,
              frameRate: fps
            }
          : {
              width: 1280,
              height: 720,
              frameRate: fps
            };

      await liveRoom
        .localParticipant
        .setScreenShareEnabled(
          sharing,
          {
            audio: true,
            resolution
          }
        );

      $('share').innerHTML =
        sharing
          ? '⏹ Parar transmissão'
          : '🖥 Compartilhar tela';

      $('status').textContent =
        sharing
          ? 'AO VIVO'
          : 'ONLINE';

      if (!sharing) {
        removeLocalPreview();
      }

      updateStage();

    } catch (err) {

      sharing = false;

      $('share').innerHTML =
        '🖥 Compartilhar tela';

      $('status').textContent =
        'ONLINE';

      setMessage(
        'O compartilhamento foi cancelado ou não pôde ser iniciado.',
        true
      );
    }
  };


/* =========================
   CONVITE
========================= */

$('invite').onclick =
  async () => {

    const url =
      `${location.origin}${location.pathname}?room=${encodeURIComponent(currentCode)}`;

    try {

      await navigator
        .clipboard
        .writeText(url);

      setMessage(
        'Link do convite copiado! Agora é só mandar para a pessoa.',
        true
      );

    } catch {

      setMessage(
        `Convite: ${url}`,
        true
      );
    }
  };


/* =========================
   VOLUME
========================= */

if ($('volume')) {

  $('volume')
    .addEventListener(
      'input',
      () => {

        const value =
          Number(
            $('volume').value
          ) / 100;

        document
          .querySelectorAll(
            '#videos video'
          )
          .forEach(
            (video) => {
              video.volume =
                value;
            }
          );
      }
    );
}


/* =========================
   SAIR
========================= */

$('leave').onclick =
  async () => {

    if (liveRoom) {
      await liveRoom.disconnect();
    }

    location.href =
      location.pathname;
  };


window.addEventListener(
  'beforeunload',
  () => {
    liveRoom?.disconnect();
  }
);


/* =========================
   CONVITE RECEBIDO
========================= */

$('name').value =
  localStorage.getItem(
    'mtrName'
  ) || '';

const invitedRoom =
  new URLSearchParams(
    location.search
  ).get('room');

if (invitedRoom) {

  $('roomCode').value =
    normalizeRoom(
      invitedRoom
    );

  setMessage(
    'Convite carregado. Coloque seu nome e clique em “Entrar na sala”.'
  );
}
