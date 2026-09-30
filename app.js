const $ = (id) => document.getElementById(id);
const LK = window.LivekitClient;

let liveRoom = null;
let currentCode = "";
let sharing = false;
let localScreenStream = null;
let localScreenTrack = null;

/* =========================
   UTILIDADES
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
  const el = $(inRoom ? "roomMsg" : "msg");
  if (el) el.textContent = text || "";
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
      throw new Error(data.error || "Não foi possível entrar.");
    }

    liveRoom = new LK.Room({
      adaptiveStream: true,
      dynacast: true,
    });

    bindRoomEvents(liveRoom);

    await liveRoom.connect(data.url, data.token);

    currentCode = data.room;

    localStorage.setItem("mtrName", name);

    history.replaceState(
      {},
      "",
      `?room=${encodeURIComponent(currentCode)}`
    );

    $("roomCode").value = currentCode;
    $("roomTitle").textContent = `Sala ${currentCode}`;

    $("landing").classList.add("hidden");
    $("roomView").classList.remove("hidden");

    if ($("status")) {
      $("status").textContent = "ONLINE";
    }

    setMessage("");
    updatePeople();
    updateStage();

    console.log("MTR Stream conectado:", currentCode);
  } catch (err) {
    console.error("Erro ao entrar:", err);

    setMessage(
      err.message || "Erro ao conectar."
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
        attachVideo(track, participant);
      }

      updatePeople();
      updateStage();
    }
  );

  room.on(
    LK.RoomEvent.TrackUnsubscribed,
    (track) => {
      track.detach().forEach((el) => el.remove());

      document
        .querySelectorAll(`[data-track-sid="${track.sid}"]`)
        .forEach((el) => el.remove());

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
      updateStage();
    }
  );

  room.on(
    LK.RoomEvent.Disconnected,
    () => {
      if ($("status")) {
        $("status").textContent = "DESCONECTADO";
      }

      sharing = false;
      updateShareButton();
    }
  );
}

/* =========================
   VÍDEOS
========================= */

function attachVideo(track, participant, local = false) {
  const rawId =
    `video-${participant.identity}-${track.sid || "screen"}`;

  const id = rawId.replace(
    /[^a-zA-Z0-9_-]/g,
    ""
  );

  if ($(id)) return;

  const wrap = document.createElement("div");

  wrap.className = "video-card";
  wrap.id = id;

  if (track.sid) {
    wrap.dataset.trackSid = track.sid;
  }

  if (local) {
    wrap.dataset.localPreview = "1";
  }

  const video = track.attach();

  video.autoplay = true;
  video.playsInline = true;

  /*
   * Preview local fica mudo para não criar
   * eco do próprio áudio.
   */
  if (local) {
    video.muted = true;
  }

  const label = document.createElement("div");

  label.className = "video-label";

  label.textContent =
    `${participant.name || "Participante"}${
      local ? " • você" : ""
    }`;

  wrap.append(video, label);

  $("videos").appendChild(wrap);

  updateStage();
}

function createLocalPreview(stream) {
  removeLocalPreview();

  const videoTrack = stream.getVideoTracks()[0];

  if (!videoTrack) return;

  const wrap = document.createElement("div");

  wrap.className = "video-card";
  wrap.dataset.localPreview = "1";

  const video = document.createElement("video");

  video.srcObject = stream;
  video.autoplay = true;
  video.playsInline = true;
  video.muted = true;

  const label = document.createElement("div");

  label.className = "video-label";
  label.textContent =
    `${liveRoom?.localParticipant?.name || "Você"} • você`;

  wrap.append(video, label);

  $("videos").appendChild(wrap);

  updateStage();
}

function removeLocalPreview() {
  document
    .querySelectorAll('[data-local-preview="1"]')
    .forEach((el) => {
      const video = el.querySelector("video");

      if (video) {
        video.srcObject = null;
      }

      el.remove();
    });
}

function updateStage() {
  if (!$("emptyStage") || !$("videos")) return;

  const hasVideo =
    $("videos").children.length > 0;

  $("emptyStage").classList.toggle(
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
    const chip = document.createElement("span");

    if (
      participant === liveRoom.localParticipant
    ) {
      chip.textContent =
        `${participant.name || "Você"} (você)`;
    } else {
      chip.textContent =
        participant.name || "Participante";
    }

    $("people").appendChild(chip);
  });
}

/* =========================
   BOTÃO COMPARTILHAR
========================= */

function updateShareButton() {
  if (!$("share")) return;

  $("share").textContent = sharing
    ? "⏹ Parar transmissão"
    : "🖥 Compartilhar tela";
}

async function startScreenShare() {
  if (!liveRoom) {
    setMessage(
      "Entre em uma sala primeiro.",
      true
    );

    return;
  }

  if (
    !navigator.mediaDevices ||
    !navigator.mediaDevices.getDisplayMedia
  ) {
    setMessage(
      "Seu navegador não permite compartilhamento de tela.",
      true
    );

    return;
  }

  const quality =
    $("quality")?.value || "720";

  const fps =
    Number($("fps")?.value || 30);

  const width =
    quality === "1080" ? 1920 : 1280;

  const height =
    quality === "1080" ? 1080 : 720;

  try {
    setMessage(
      "Escolha a janela ou tela que deseja transmitir.",
      true
    );

    /*
     * IMPORTANTE:
     * getDisplayMedia é chamado DIRETAMENTE pelo clique.
     * Isso força o Edge/Chrome a abrir o seletor.
     */
    const stream =
      await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: {
            ideal: width,
          },
          height: {
            ideal: height,
          },
          frameRate: {
            ideal: fps,
            max: fps,
          },
        },

        audio: true,
      });

    const videoTrack =
      stream.getVideoTracks()[0];

    if (!videoTrack) {
      stream
        .getTracks()
        .forEach((track) => track.stop());

      throw new Error(
        "Nenhuma tela foi selecionada."
      );
    }

    localScreenStream = stream;

    createLocalPreview(stream);

    /*
     * Criamos uma track LiveKit usando exatamente
     * a tela que o navegador acabou de selecionar.
     */
    localScreenTrack =
      new LK.LocalVideoTrack(videoTrack);

    await liveRoom.localParticipant.publishTrack(
      localScreenTrack,
      {
        source: LK.Track.Source.ScreenShare,
        name: "MTR Screen",
      }
    );

    /*
     * Se o navegador forneceu áudio da tela,
     * publicamos também.
     */
    const audioTrack =
      stream.getAudioTracks()[0];

    if (audioTrack) {
      const localAudioTrack =
        new LK.LocalAudioTrack(audioTrack);

      await liveRoom.localParticipant.publishTrack(
        localAudioTrack,
        {
          source:
            LK.Track.Source.ScreenShareAudio,
          name: "MTR Screen Audio",
        }
      );
    }

    sharing = true;

    updateShareButton();

    setMessage(
      "🔴 Sua transmissão começou!",
      true
    );

    /*
     * Detecta quando a pessoa aperta
     * "Parar compartilhamento" no próprio Edge.
     */
    videoTrack.addEventListener(
      "ended",
      async () => {
        await stopScreenShare();
      },
      { once: true }
    );

    console.log(
      "Compartilhamento iniciado."
    );
  } catch (err) {
    console.error(
      "Erro ao compartilhar tela:",
      err
    );

    sharing = false;

    updateShareButton();
    removeLocalPreview();

    if (
      err.name === "NotAllowedError" ||
      err.name === "AbortError"
    ) {
      setMessage(
        "Compartilhamento cancelado.",
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
}

async function stopScreenShare() {
  if (!sharing && !localScreenStream) {
    return;
  }

  try {
    if (liveRoom) {
      const publications = [
        ...liveRoom.localParticipant
          .trackPublications.values(),
      ];

      for (const publication of publications) {
        if (
          publication.source ===
            LK.Track.Source.ScreenShare ||
          publication.source ===
            LK.Track.Source.ScreenShareAudio
        ) {
          if (publication.track) {
            await liveRoom.localParticipant
              .unpublishTrack(
                publication.track
              )
              .catch(() => {});
          }
        }
      }
    }

    if (localScreenStream) {
      localScreenStream
        .getTracks()
        .forEach((track) => {
          track.stop();
        });
    }
  } catch (err) {
    console.error(
      "Erro ao parar transmissão:",
      err
    );
  }

  localScreenStream = null;
  localScreenTrack = null;

  sharing = false;

  removeLocalPreview();
  updateShareButton();
  updateStage();

  setMessage(
    "Transmissão encerrada.",
    true
  );
}

/* =========================
   BOTÕES
========================= */

$("create").onclick = () => {
  enter(true);
};

$("join").onclick = () => {
  enter(false);
};

$("share").onclick = async () => {
  /*
   * Não usamos setScreenShareEnabled aqui.
   * O navegador abre o seletor diretamente.
   */
  if (sharing) {
    await stopScreenShare();
  } else {
    await startScreenShare();
  }
};

/* =========================
   CONVITE
========================= */

$("invite").onclick = async () => {
  const url =
    `${location.origin}${location.pathname}` +
    `?room=${encodeURIComponent(currentCode)}`;

  try {
    await navigator.clipboard.writeText(url);

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
          "#videos video:not([muted])"
        )
        .forEach((video) => {
          video.volume = volume;
        });
    }
  );
}

/* =========================
   SAIR
========================= */

$("leave").onclick = async () => {
  await stopScreenShare();

  if (liveRoom) {
    await liveRoom.disconnect();
  }

  location.href = location.pathname;
};

/* =========================
   FECHAR SITE
========================= */

window.addEventListener(
  "beforeunload",
  () => {
    if (localScreenStream) {
      localScreenStream
        .getTracks()
        .forEach((track) => {
          track.stop();
        });
    }

    liveRoom?.disconnect();
  }
);

/* =========================
   INICIALIZAÇÃO
========================= */

$("name").value =
  localStorage.getItem("mtrName") || "";

const invitedRoom =
  new URLSearchParams(
    location.search
  ).get("room");

if (invitedRoom) {
  $("roomCode").value =
    normalizeRoom(invitedRoom);

  setMessage(
    'Convite carregado. Coloque seu nome e clique em "Entrar na sala".'
  );
}

updateShareButton();

console.log(
  "MTR Stream carregado — compartilhamento de tela pronto."
);
