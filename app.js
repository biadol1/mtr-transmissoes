const $ = (id) => document.getElementById(id);
const LK = window.LivekitClient;

let liveRoom = null;
let currentCode = "";
let sharing = false;
let screenStream = null;
let screenPublication = null;

/* =========================
   SALA
========================= */

function roomCode() {
  return "MTR-" + Math.random().toString(36).slice(2, 7).toUpperCase();
}

function normalizeRoom(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, "")
    .slice(0, 32);
}

function setMessage(text, inRoom = false) {
  const element = $(inRoom ? "roomMsg" : "msg");

  if (element) {
    element.textContent = text || "";
  }
}

/* =========================
   ENTRAR NA SALA
========================= */

async function enter(create) {
  const name = $("name").value.trim();
  let code = normalizeRoom($("roomCode").value);

  if (!name) {
    return setMessage("Coloque seu nome para continuar.");
  }

  if (create && !code) {
    code = roomCode();
  }

  if (!code) {
    return setMessage("Digite o código da sala.");
  }

  setMessage("Conectando...");

  $("create").disabled = true;
  $("join").disabled = true;

  try {
    const response = await fetch("/api/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name,
        room: code,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data.error || "Não foi possível entrar na sala."
      );
    }

    liveRoom = new LK.Room({
      adaptiveStream: true,
      dynacast: true,
    });

    bindRoomEvents(liveRoom);

    await liveRoom.connect(
      data.url,
      data.token
    );

    currentCode = data.room;

    localStorage.setItem(
      "mtrName",
      name
    );

    history.replaceState(
      {},
      "",
      `?room=${encodeURIComponent(currentCode)}`
    );

    $("roomCode").value = currentCode;

    $("roomTitle").textContent =
      `Sala ${currentCode}`;

    $("landing").classList.add("hidden");
    $("roomView").classList.remove("hidden");

    if ($("status")) {
      $("status").textContent = "ONLINE";
    }

    setMessage("");

    updatePeople();

  } catch (err) {

    console.error(
      "Erro ao entrar na sala:",
      err
    );

    setMessage(
      err.message ||
      "Erro ao conectar."
    );

  } finally {

    $("create").disabled = false;
    $("join").disabled = false;
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
    }
  );

  room.on(
    LK.RoomEvent.TrackUnsubscribed,
    (track) => {

      track.detach()
        .forEach((element) => {
          element.remove();
        });

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
    LK.RoomEvent.Disconnected,
    () => {

      if ($("status")) {
        $("status").textContent =
          "OFFLINE";
      }
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

  const identity =
    participant?.identity ||
    "participant";

  const trackId =
    track.sid ||
    track.mediaStreamTrack?.id ||
    "screen";

  const id =
    `video-${identity}-${trackId}`
      .replace(
        /[^a-zA-Z0-9_-]/g,
        ""
      );

  if ($(id)) return;

  const wrap =
    document.createElement("div");

  wrap.className = "video-card";
  wrap.id = id;

  if (local) {
    wrap.dataset.localPreview = "1";
  }

  const video = track.attach();

  video.autoplay = true;
  video.playsInline = true;

  if (local) {
    video.muted = true;
  }

  const label =
    document.createElement("div");

  label.className = "video-label";

  label.textContent =
    `${participant?.name || "Participante"}${
      local ? " • você" : ""
    }`;

  wrap.append(
    video,
    label
  );

  $("videos").appendChild(wrap);

  updateStage();
}

function removeLocalPreview() {

  document
    .querySelectorAll(
      '[data-local-preview="1"]'
    )
    .forEach((element) => {
      element.remove();
    });

  updateStage();
}

/* =========================
   PALCO
========================= */

function updateStage() {

  if (!$("emptyStage") || !$("videos")) {
    return;
  }

  const hasVideo =
    $("videos").children.length > 0;

  $("emptyStage")
    .classList
    .toggle(
      "hidden",
      hasVideo
    );
}

/* =========================
   PARTICIPANTES
========================= */

function updatePeople() {

  if (!liveRoom) return;

  const all = [
    liveRoom.localParticipant,
    ...liveRoom.remoteParticipants.values(),
  ];

  if ($("count")) {
    $("count").textContent =
      `${all.length}/6 assistindo`;
  }

  if ($("sideCount")) {
    $("sideCount").textContent =
      `${all.length}/6`;
  }

  if (!$("people")) return;

  $("people").innerHTML = "";

  all.forEach((participant) => {

    const chip =
      document.createElement("span");

    if (
      participant ===
      liveRoom.localParticipant
    ) {

      chip.textContent =
        `${participant.name || "Você"} (você)`;

    } else {

      chip.textContent =
        participant.name ||
        "Participante";
    }

    $("people")
      .appendChild(chip);
  });
}

/* =========================
   BOTÕES ENTRADA
========================= */

$("create").onclick =
  () => enter(true);

$("join").onclick =
  () => enter(false);

/* =========================
   COMPARTILHAR TELA
========================= */

$("share").onclick = async () => {

  console.log(
    "BOTÃO COMPARTILHAR CLICADO"
  );

  if (!liveRoom) {

    setMessage(
      "Você ainda não está conectado à sala.",
      true
    );

    return;
  }

  /* Se já estiver transmitindo,
     clicar novamente encerra */

  if (sharing) {

    await stopScreenShare();

    return;
  }

  if (
    !navigator.mediaDevices ||
    !navigator.mediaDevices.getDisplayMedia
  ) {

    setMessage(
      "Seu navegador não oferece compartilhamento de tela.",
      true
    );

    return;
  }

  try {

    setMessage(
      "Escolha a janela, guia ou tela que deseja compartilhar.",
      true
    );

    /*
      ESTA PARTE ABRE A JANELA
      NATIVA DO EDGE
    */

    screenStream =
      await navigator.mediaDevices
        .getDisplayMedia({
          video: {
            frameRate:
              $("fps")?.value === "60"
                ? 60
                : 30,
          },

          audio: true,
        });

    console.log(
      "Tela selecionada:",
      screenStream
    );

    const videoTrack =
      screenStream
        .getVideoTracks()[0];

    if (!videoTrack) {

      throw new Error(
        "Nenhuma tela foi selecionada."
      );
    }

    /*
      TRANSFORMA A CAPTURA
      EM TRACK DO LIVEKIT
    */

    const localVideoTrack =
      new LK.LocalVideoTrack(
        videoTrack
      );

    /*
      PUBLICA PARA AS OUTRAS
      PESSOAS DA SALA
    */

    screenPublication =
      await liveRoom
        .localParticipant
        .publishTrack(
          localVideoTrack,
          {
            source:
              LK.Track.Source.ScreenShare,
          }
        );

    sharing = true;

    $("share").textContent =
      "⏹ Parar transmissão";

    /*
      MOSTRA A PRÓPRIA
      TRANSMISSÃO
    */

    attachVideo(
      localVideoTrack,
      liveRoom.localParticipant,
      true
    );

    setMessage(
      "Sua tela está sendo transmitida.",
      true
    );

    /*
      Detecta quando você aperta
      "Parar compartilhamento"
      no próprio Edge
    */

    videoTrack.onended =
      async () => {

        if (sharing) {
          await stopScreenShare();
        }
      };

  } catch (err) {

    console.error(
      "ERRO AO COMPARTILHAR:",
      err
    );

    sharing = false;

    $("share").textContent =
      "🖥 Compartilhar tela";

    if (
      err.name === "NotAllowedError"
    ) {

      setMessage(
        "O compartilhamento foi cancelado.",
        true
      );

    } else {

      setMessage(
        `Erro ao compartilhar: ${
          err.message ||
          "não foi possível iniciar."
        }`,
        true
      );
    }
  }
};

/* =========================
   PARAR TRANSMISSÃO
========================= */

async function stopScreenShare() {

  sharing = false;

  try {

    if (
      screenPublication?.track &&
      liveRoom
    ) {

      await liveRoom
        .localParticipant
        .unpublishTrack(
          screenPublication.track
        );
    }

  } catch (err) {

    console.warn(
      "Erro ao remover publicação:",
      err
    );
  }

  if (screenStream) {

    screenStream
      .getTracks()
      .forEach((track) => {

        track.onended = null;
        track.stop();
      });
  }

  screenStream = null;
  screenPublication = null;

  removeLocalPreview();

  if ($("share")) {

    $("share").textContent =
      "🖥 Compartilhar tela";
  }

  setMessage(
    "Transmissão encerrada.",
    true
  );
}

/* =========================
   COPIAR CONVITE
========================= */

$("invite").onclick = async () => {

  const url =
    `${location.origin}${location.pathname}` +
    `?room=${encodeURIComponent(currentCode)}`;

  try {

    await navigator.clipboard
      .writeText(url);

    setMessage(
      "Link do convite copiado! Agora é só mandar para a pessoa.",
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

if ($("volume")) {

  $("volume")
    .addEventListener(
      "input",
      () => {

        const volume =
          Number(
            $("volume").value
          ) / 100;

        document
          .querySelectorAll(
            ".video-card video"
          )
          .forEach((video) => {

            if (!video.muted) {
              video.volume = volume;
            }
          });
      }
    );
}

/* =========================
   SAIR
========================= */

$("leave").onclick = async () => {

  if (sharing) {

    await stopScreenShare();
  }

  if (liveRoom) {

    await liveRoom.disconnect();
  }

  location.href =
    location.pathname;
};

/* =========================
   FECHAR SITE
========================= */

window.addEventListener(
  "beforeunload",
  () => {

    if (screenStream) {

      screenStream
        .getTracks()
        .forEach(
          (track) =>
            track.stop()
        );
    }

    liveRoom?.disconnect();
  }
);

/* =========================
   NOME SALVO
========================= */

$("name").value =
  localStorage.getItem(
    "mtrName"
  ) || "";

/* =========================
   CONVITE RECEBIDO
========================= */

const invitedRoom =
  new URLSearchParams(
    location.search
  ).get("room");

if (invitedRoom) {

  $("roomCode").value =
    normalizeRoom(
      invitedRoom
    );

  setMessage(
    "Convite carregado. Coloque seu nome e clique em “Entrar na sala”."
  );
}

console.log(
  "MTR Stream carregado — compartilhamento de tela pronto."
);
