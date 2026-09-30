const $ = (id) => document.getElementById(id);
const LK = window.LivekitClient;

let liveRoom = null;
let currentCode = "";
let sharing = false;

const MAX_PARTICIPANTS = 6;

/* =========================
   SALA
========================= */

function roomCode() {
  return (
    "MTR-" +
    Math.random()
      .toString(36)
      .slice(2, 7)
      .toUpperCase()
  );
}

function normalizeRoom(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, "")
    .slice(0, 32);
}

function setMessage(text, inRoom = false) {
  const el = $(inRoom ? "roomMsg" : "msg");

  if (el) {
    el.textContent = text || "";
  }
}

/* =========================
   ENTRAR / CRIAR SALA
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

    if ($("roomTitle")) {
      $("roomTitle").textContent =
        `Sala ${currentCode}`;
    }

    $("landing").classList.add("hidden");
    $("roomView").classList.remove("hidden");

    if ($("status")) {
      $("status").textContent = "ONLINE";
    }

    setMessage("");
    updatePeople();
    updateStage();

  } catch (err) {
    console.error(err);

    setMessage(
      err.message ||
        "Erro ao conectar à sala."
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

      if (
        track.kind === LK.Track.Kind.Video
      ) {
        attachVideo(
          track,
          participant,
          false
        );
      }

      updatePeople();
      updateStage();
    }
  );

  room.on(
    LK.RoomEvent.TrackUnsubscribed,
    (track) => {

      track.detach().forEach((el) => {
        el.remove();
      });

      removeEmptyVideoCards();

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
      removeEmptyVideoCards();
      updateStage();
    }
  );

  room.on(
    LK.RoomEvent.LocalTrackPublished,
    (publication) => {

      if (
        publication.source ===
        LK.Track.Source.ScreenShare
      ) {
        const track = publication.track;

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
    (publication) => {

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

      if ($("status")) {
        $("status").textContent =
          "OFFLINE";
      }

      sharing = false;

      if ($("share")) {
        $("share").textContent =
          "🖥 Compartilhar tela";
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

  const rawId =
    `video-${participant.identity}-${track.sid || "screen"}`;

  const id = rawId.replace(
    /[^a-zA-Z0-9_-]/g,
    ""
  );

  if ($(id)) {
    return;
  }

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

  /*
   * Preview local fica sem áudio para
   * não criar eco no computador de quem
   * está transmitindo.
   */
  if (local) {
    video.muted = true;
  }

  const label =
    document.createElement("div");

  label.className = "video-label";

  label.textContent =
    `${participant.name || "Participante"}${
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
    .forEach((el) => el.remove());
}

function removeEmptyVideoCards() {
  document
    .querySelectorAll(".video-card")
    .forEach((card) => {

      if (
        !card.querySelector("video")
      ) {
        card.remove();
      }
    });
}

/* =========================
   TELA VAZIA
========================= */

function updateStage() {
  if (
    !$("emptyStage") ||
    !$("videos")
  ) {
    return;
  }

  const hasVideo =
    $("videos").querySelector(
      ".video-card"
    );

  $("emptyStage").classList.toggle(
    "hidden",
    !!hasVideo
  );
}

/* =========================
   PARTICIPANTES
========================= */

function updatePeople() {
  if (!liveRoom) {
    return;
  }

  const all = [
    liveRoom.localParticipant,
    ...liveRoom.remoteParticipants.values(),
  ];

  if ($("count")) {
    $("count").textContent =
      `👥 ${all.length}/${MAX_PARTICIPANTS} assistindo`;
  }

  if ($("sideCount")) {
    $("sideCount").textContent =
      `${all.length}/${MAX_PARTICIPANTS}`;
  }

  if (!$("people")) {
    return;
  }

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

    $("people").appendChild(chip);
  });
}

/* =========================
   CRIAR / ENTRAR
========================= */

$("create").onclick = () => {
  enter(true);
};

$("join").onclick = () => {
  enter(false);
};

/* =========================
   COMPARTILHAR TELA
========================= */

$("share").onclick = async () => {

  if (!liveRoom) {
    return;
  }

  setMessage("", true);

  /*
   * Se já estiver transmitindo,
   * o botão encerra a transmissão.
   */
  if (sharing) {

    try {
      await liveRoom.localParticipant
        .setScreenShareEnabled(false);

      sharing = false;

      $("share").textContent =
        "🖥 Compartilhar tela";

      removeLocalPreview();

      updateStage();

      setMessage(
        "Transmissão encerrada.",
        true
      );

    } catch (err) {
      console.error(err);

      setMessage(
        "Não foi possível parar a transmissão.",
        true
      );
    }

    return;
  }

  /*
   * Primeiro tentamos compartilhar
   * COM áudio.
   *
   * Se o navegador/computador não
   * permitir áudio, tentamos novamente
   * SEM áudio.
   */
  try {

    setMessage(
      "Escolha a tela ou janela que deseja compartilhar.",
      true
    );

    try {

      await liveRoom.localParticipant
        .setScreenShareEnabled(
          true,
          {
            audio: true,
          }
        );

    } catch (audioError) {

      console.warn(
        "Compartilhamento com áudio não disponível. Tentando sem áudio.",
        audioError
      );

      await liveRoom.localParticipant
        .setScreenShareEnabled(
          true,
          {
            audio: false,
          }
        );
    }

    sharing = true;

    $("share").textContent =
      "⏹ Parar transmissão";

    setMessage(
      "Sua tela está sendo compartilhada.",
      true
    );

    updateStage();

  } catch (err) {

    console.error(
      "Erro ao compartilhar:",
      err
    );

    sharing = false;

    $("share").textContent =
      "🖥 Compartilhar tela";

    /*
     * NotAllowedError normalmente significa
     * que a pessoa cancelou a janela do
     * navegador ou bloqueou a permissão.
     */
    if (
      err?.name === "NotAllowedError"
    ) {
      setMessage(
        "O compartilhamento foi cancelado ou bloqueado pelo navegador.",
        true
      );
    } else {
      setMessage(
        "Não foi possível compartilhar a tela. Tente escolher outra janela ou a tela inteira.",
        true
      );
    }
  }
};

/* =========================
   COPIAR CONVITE
========================= */

$("invite").onclick = async () => {

  const url =
    `${location.origin}${location.pathname}` +
    `?room=${encodeURIComponent(currentCode)}`;

  try {

    await navigator.clipboard.writeText(
      url
    );

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

  $("volume").addEventListener(
    "input",
    (event) => {

      const volume =
        Number(event.target.value) / 100;

      document
        .querySelectorAll(
          "#videos video"
        )
        .forEach((video) => {

          /*
           * Não altera o preview local.
           */
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

  try {

    if (liveRoom) {

      if (sharing) {
        await liveRoom.localParticipant
          .setScreenShareEnabled(false)
          .catch(() => {});
      }

      await liveRoom.disconnect();
    }

  } finally {

    location.href =
      location.pathname;
  }
};

/* =========================
   FECHAR PÁGINA
========================= */

window.addEventListener(
  "beforeunload",
  () => {

    if (liveRoom) {
      liveRoom.disconnect();
    }
  }
);

/* =========================
   NOME SALVO + CONVITE
========================= */

$("name").value =
  localStorage.getItem(
    "mtrName"
  ) || "";

const invitedRoom =
  new URLSearchParams(
    location.search
  ).get("room");

if (invitedRoom) {

  $("roomCode").value =
    normalizeRoom(invitedRoom);

  setMessage(
    "Convite carregado. Coloque seu nome e clique em “Entrar na sala”."
  );
}
