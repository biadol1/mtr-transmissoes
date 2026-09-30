const $ = (id) => document.getElementById(id);
const LK = window.LivekitClient;

let liveRoom = null;
let currentCode = "";
let sharing = false;
let localScreenStream = null;
let localScreenTrack = null;
let localScreenAudioTrack = null;


/* =====================================================
   UTILIDADES
===================================================== */

function roomCode() {
  return "MTR-" + Math.random()
    .toString(36)
    .slice(2, 7)
    .toUpperCase();
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


/* =====================================================
   ENTRAR / CRIAR SALA
===================================================== */

async function enter(create) {

  const name = $("name").value.trim();

  let code = normalizeRoom(
    $("roomCode").value
  );

  if (!name) {
    setMessage(
      "Coloque seu nome para continuar."
    );
    return;
  }

  if (create && !code) {
    code = roomCode();
  }

  if (!code) {
    setMessage(
      "Digite o código da sala."
    );
    return;
  }

  setMessage("Conectando...");

  $("create").disabled = true;
  $("join").disabled = true;

  try {

    const response = await fetch(
      "/api/token",
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json",
        },

        body: JSON.stringify({
          name: name,
          room: code,
        }),
      }
    );

    const data =
      await response.json();

    if (!response.ok) {
      throw new Error(
        data.error ||
        "Não foi possível entrar."
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
      `?room=${encodeURIComponent(
        currentCode
      )}`
    );

    $("roomCode").value =
      currentCode;

    $("roomTitle").textContent =
      `Sala ${currentCode}`;

    $("landing").classList.add(
      "hidden"
    );

    $("roomView").classList.remove(
      "hidden"
    );

    if ($("status")) {
      $("status").textContent =
        "ONLINE";
    }

    setMessage("");

    updatePeople();
    updateStage();

    console.log(
      "MTR Stream conectado:",
      currentCode
    );

  } catch (error) {

    console.error(
      "Erro ao entrar:",
      error
    );

    setMessage(
      error.message ||
      "Erro ao conectar."
    );

  } finally {

    $("create").disabled = false;
    $("join").disabled = false;
  }
}


/* =====================================================
   EVENTOS LIVEKIT
===================================================== */

function bindRoomEvents(room) {

  room.on(
    LK.RoomEvent.TrackSubscribed,
    (
      track,
      publication,
      participant
    ) => {

     if (track.kind === LK.Track.Kind.Video) {
  attachVideo(track, participant);
}

if (track.kind === LK.Track.Kind.Audio) {
  const audio = track.attach();

  audio.autoplay = true;
  audio.controls = false;
  audio.volume = Number($("volume")?.value || 75) / 100;

  document.body.appendChild(audio);

  audio.play().catch(() => {
    console.log("Áudio aguardando interação do usuário.");

    document.addEventListener(
      "click",
      () => {
        audio.play().catch(() => {});
      },
      { once: true }
    );
  });

  console.log("ÁUDIO DA TRANSMISSÃO RECEBIDO");
}

updatePeople();
updateStage();
    }
  );


  room.on(
    LK.RoomEvent.TrackUnsubscribed,
    (track) => {

      try {

        track
          .detach()
          .forEach((element) => {
            element.remove();
          });

      } catch (error) {

        console.warn(
          "Erro removendo vídeo:",
          error
        );
      }

      if (track.sid) {

        document
          .querySelectorAll(
            `[data-track-sid="${track.sid}"]`
          )
          .forEach(
            (element) =>
              element.remove()
          );
      }

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
        $("status").textContent =
          "DESCONECTADO";
      }

      sharing = false;

      updateShareButton();
    }
  );
}


/* =====================================================
   VÍDEOS
===================================================== */

function attachVideo(
  track,
  participant,
  local = false
) {

  const participantId =
    participant?.identity ||
    "participant";

  const trackId =
    track.sid ||
    track.mediaStreamTrack?.id ||
    "screen";

  const id =
    `video-${participantId}-${trackId}`
      .replace(
        /[^a-zA-Z0-9_-]/g,
        ""
      );

  if ($(id)) {
    return;
  }

  const wrap =
    document.createElement("div");

  wrap.className =
    "video-card";

  wrap.id = id;

  if (track.sid) {
    wrap.dataset.trackSid =
      track.sid;
  }

  if (local) {
    wrap.dataset.localPreview =
      "1";
  }

  const video =
    track.attach();

  video.autoplay = true;
  video.playsInline = true;

  if (local) {
    video.muted = true;
  }

  const label =
    document.createElement("div");

  label.className =
    "video-label";

  label.textContent =
    `${
      participant?.name ||
      "Participante"
    }${
      local
        ? " • você"
        : ""
    }`;

  wrap.append(
    video,
    label
  );

  $("videos")
    .appendChild(wrap);

  updateStage();
}


/* =====================================================
   PREVIEW LOCAL
===================================================== */

function createLocalPreview(
  stream
) {

  removeLocalPreview();

  const videoTrack =
    stream.getVideoTracks()[0];

  if (!videoTrack) {
    return;
  }

  const wrap =
    document.createElement("div");

  wrap.className =
    "video-card";

  wrap.dataset.localPreview =
    "1";

  const video =
    document.createElement("video");

  video.srcObject =
    new MediaStream([
      videoTrack,
    ]);

  video.autoplay = true;
  video.playsInline = true;
  video.muted = true;

  const label =
    document.createElement("div");

  label.className =
    "video-label";

  label.textContent =
    `${
      liveRoom
        ?.localParticipant
        ?.name ||
      "Você"
    } • você`;

  wrap.append(
    video,
    label
  );

  $("videos")
    .appendChild(wrap);

  updateStage();
}


function removeLocalPreview() {

  document
    .querySelectorAll(
      '[data-local-preview="1"]'
    )
    .forEach((element) => {

      const video =
        element.querySelector(
          "video"
        );

      if (video) {
        video.srcObject = null;
      }

      element.remove();
    });

  updateStage();
}


/* =====================================================
   PALCO
===================================================== */

function updateStage() {

  if (
    !$("emptyStage") ||
    !$("videos")
  ) {
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


/* =====================================================
   PARTICIPANTES
===================================================== */

function updatePeople() {

  if (!liveRoom) {
    return;
  }

  const participants = [
    liveRoom.localParticipant,
    ...liveRoom
      .remoteParticipants
      .values(),
  ];

  const total =
    participants.length;

  if ($("count")) {

    $("count").textContent =
      `${total}/6 assistindo`;
  }

  if ($("sideCount")) {

    $("sideCount").textContent =
      `${total}/6`;
  }

  if (!$("people")) {
    return;
  }

  $("people").innerHTML = "";

  participants.forEach(
    (participant) => {

      const chip =
        document.createElement(
          "span"
        );

      if (
        participant ===
        liveRoom.localParticipant
      ) {

        chip.textContent =
          `${
            participant.name ||
            "Você"
          } (você)`;

      } else {

        chip.textContent =
          participant.name ||
          "Participante";
      }

      $("people")
        .appendChild(chip);
    }
  );
}


/* =====================================================
   BOTÃO COMPARTILHAR
===================================================== */

function updateShareButton() {

  const button =
    $("share");

  if (!button) {
    return;
  }

  if (sharing) {

    button.textContent =
      "⏹ Parar transmissão";

  } else {

    button.textContent =
      "🖥 Compartilhar tela";
  }
}


/* =====================================================
   COMEÇAR COMPARTILHAMENTO
===================================================== */

async function startScreenShare() {

  console.log(
    "startScreenShare chamada"
  );

  if (!liveRoom) {

    setMessage(
      "Entre em uma sala primeiro.",
      true
    );

    return;
  }

  if (
    !navigator.mediaDevices ||
    !navigator.mediaDevices
      .getDisplayMedia
  ) {

    setMessage(
      "Seu navegador não permite compartilhamento de tela.",
      true
    );

    return;
  }


  const quality =
    $("quality")?.value ||
    "720";

  const fps =
    Number(
      $("fps")?.value ||
      30
    );

  const width =
    quality === "1080"
      ? 1920
      : 1280;

  const height =
    quality === "1080"
      ? 1080
      : 720;


  try {

    setMessage(
      "Escolha a janela ou tela que deseja transmitir.",
      true
    );


    /*
       ESSA É A CHAMADA QUE JÁ
       FUNCIONOU NO SEU EDGE.
    */

    const stream =
      await navigator
        .mediaDevices
        .getDisplayMedia({

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


    console.log(
      "Tela selecionada:",
      stream
    );


    const videoTrack =
      stream
        .getVideoTracks()[0];


    if (!videoTrack) {

      stream
        .getTracks()
        .forEach(
          (track) =>
            track.stop()
        );

      throw new Error(
        "Nenhuma tela foi selecionada."
      );
    }


    localScreenStream =
      stream;


    /*
       PRIMEIRO MOSTRAMOS
       O PREVIEW
    */

    createLocalPreview(
      stream
    );


    /*
       TRANSFORMA O VÍDEO
       EM TRACK LIVEKIT
    */

    localScreenTrack =
      new LK.LocalVideoTrack(
        videoTrack
      );


    /*
       PUBLICA A TELA
    */

    await liveRoom
      .localParticipant
      .publishTrack(
        localScreenTrack,
        {
          source:
            LK.Track.Source
              .ScreenShare,

          name:
            "MTR Screen",
        }
      );


    /*
       ÁUDIO DA TELA
    */

    const audioTrack =
      stream
        .getAudioTracks()[0];


    if (audioTrack) {

      try {

        localScreenAudioTrack =
          new LK.LocalAudioTrack(
            audioTrack
          );


        await liveRoom
          .localParticipant
          .publishTrack(
            localScreenAudioTrack,
            {
              source:
                LK.Track.Source
                  .ScreenShareAudio,

              name:
                "MTR Screen Audio",
            }
          );

      } catch (
        audioError
      ) {

        console.warn(
          "Não foi possível publicar o áudio da tela:",
          audioError
        );
      }
    }


    sharing = true;

    updateShareButton();


    setMessage(
      "🔴 Sua transmissão começou!",
      true
    );


    /*
       QUANDO CLICAR EM
       "PARAR COMPARTILHAMENTO"
       NO PRÓPRIO EDGE
    */

    videoTrack.addEventListener(
      "ended",
      async () => {

        if (sharing) {

          await stopScreenShare();
        }
      },

      {
        once: true,
      }
    );


    console.log(
      "Compartilhamento iniciado."
    );


  } catch (error) {

    console.error(
      "Erro ao compartilhar tela:",
      error
    );


    /*
       Se deu erro depois de
       obter o stream, paramos tudo.
    */

    if (localScreenStream) {

      localScreenStream
        .getTracks()
        .forEach(
          (track) => {

            try {
              track.stop();
            } catch {}
          }
        );
    }


    localScreenStream =
      null;

    localScreenTrack =
      null;

    localScreenAudioTrack =
      null;

    sharing = false;

    removeLocalPreview();

    updateShareButton();


    if (
      error.name ===
        "NotAllowedError" ||
      error.name ===
        "AbortError"
    ) {

      setMessage(
        "Compartilhamento cancelado.",
        true
      );

    } else {

      setMessage(
        `Erro ao compartilhar: ${
          error.message ||
          "não foi possível iniciar."
        }`,
        true
      );
    }
  }
}


/* =====================================================
   PARAR COMPARTILHAMENTO
===================================================== */

async function stopScreenShare() {

  console.log(
    "Parando compartilhamento..."
  );

  sharing = false;


  try {

    if (
      liveRoom &&
      localScreenTrack
    ) {

      await liveRoom
        .localParticipant
        .unpublishTrack(
          localScreenTrack
        )
        .catch(() => {});
    }


    if (
      liveRoom &&
      localScreenAudioTrack
    ) {

      await liveRoom
        .localParticipant
        .unpublishTrack(
          localScreenAudioTrack
        )
        .catch(() => {});
    }


  } catch (error) {

    console.warn(
      "Erro removendo tracks:",
      error
    );
  }


  if (
    localScreenStream
  ) {

    localScreenStream
      .getTracks()
      .forEach(
        (track) => {

          try {

            track.onended =
              null;

            track.stop();

          } catch {}
        }
      );
  }


  localScreenStream =
    null;

  localScreenTrack =
    null;

  localScreenAudioTrack =
    null;


  removeLocalPreview();

  updateShareButton();

  updateStage();


  setMessage(
    "Transmissão encerrada.",
    true
  );
}


/* =====================================================
   BOTÕES DE CRIAR / ENTRAR
===================================================== */

const createButton =
  $("create");

const joinButton =
  $("join");


if (createButton) {

  createButton
    .addEventListener(
      "click",
      () => {
        enter(true);
      }
    );
}


if (joinButton) {

  joinButton
    .addEventListener(
      "click",
      () => {
        enter(false);
      }
    );
}


/* =====================================================
   BOTÃO COMPARTILHAR
   CORREÇÃO PRINCIPAL
===================================================== */

const shareButton =
  $("share");


if (shareButton) {

  /*
     Remove qualquer onclick
     que possa ter vindo do HTML.
  */

  shareButton.removeAttribute(
    "onclick"
  );


  /*
     Ligamos o clique diretamente
     ao botão.
  */

  shareButton.addEventListener(
    "click",
    async function (event) {

      event.preventDefault();

      event.stopPropagation();


      console.log(
        "BOTÃO COMPARTILHAR CLICADO"
      );


      try {

        if (sharing) {

          await stopScreenShare();

        } else {

          /*
             IMPORTANTE:
             startScreenShare é chamada
             diretamente durante o clique.
          */

          await startScreenShare();
        }

      } catch (error) {

        console.error(
          "Erro no botão Compartilhar:",
          error
        );

        sharing = false;

        updateShareButton();

        setMessage(
          `Erro ao compartilhar: ${
            error?.message ||
            "não foi possível iniciar."
          }`,
          true
        );
      }
    }
  );
}


/* =====================================================
   CONVITE
===================================================== */

const inviteButton =
  $("invite");


if (inviteButton) {

  inviteButton
    .addEventListener(
      "click",
      async () => {

        const url =
          `${location.origin}` +
          `${location.pathname}` +
          `?room=${encodeURIComponent(
            currentCode
          )}`;


        try {

          await navigator
            .clipboard
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
      }
    );
}


/* =====================================================
   VOLUME
===================================================== */

const volumeSlider =
  $("volume");

if (volumeSlider) {

  volumeSlider.addEventListener(
    "input",
    (event) => {

      const volume =
        Number(event.target.value) / 100;

      document
        .querySelectorAll(
          "#videos video, body > audio"
        )
        .forEach((media) => {

          if (!media.muted) {
            media.volume = volume;
          }

        });
    }
  );
}


/* =====================================================
   SAIR
===================================================== */

const leaveButton =
  $("leave");


if (leaveButton) {

  leaveButton
    .addEventListener(
      "click",
      async () => {

        try {

          await stopScreenShare();

          if (liveRoom) {

            await liveRoom
              .disconnect();
          }

        } finally {

          location.href =
            location.pathname;
        }
      }
    );
}


/* =====================================================
   FECHAR A PÁGINA
===================================================== */

window.addEventListener(
  "beforeunload",
  () => {

    if (
      localScreenStream
    ) {

      localScreenStream
        .getTracks()
        .forEach(
          (track) => {

            try {
              track.stop();
            } catch {}
          }
        );
    }


    if (liveRoom) {

      try {
        liveRoom.disconnect();
      } catch {}
    }
  }
);


/* =====================================================
   NOME SALVO
===================================================== */

if ($("name")) {

  $("name").value =
    localStorage.getItem(
      "mtrName"
    ) || "";
}


/* =====================================================
   CONVITE RECEBIDO
===================================================== */

const invitedRoom =
  new URLSearchParams(
    location.search
  ).get("room");


if (
  invitedRoom &&
  $("roomCode")
) {

  $("roomCode").value =
    normalizeRoom(
      invitedRoom
    );


  setMessage(
    'Convite carregado. Coloque seu nome e clique em "Entrar na sala".'
  );
}


/* =====================================================
   INICIALIZAÇÃO
===================================================== */

updateShareButton();


console.log(
  "MTR Stream carregado — botão de compartilhamento corrigido."
);


/* =====================================================
   MTR — ESCOLHER QUAL TRANSMISSÃO ASSISTIR
===================================================== */

let mtrSelectedStream = null;

function mtrGetRemoteStreams() {
  return Array.from(
    document.querySelectorAll("#videos .video-card")
  ).filter((card) => {
    return card.dataset.localPreview !== "1";
  });
}

function mtrCreateStreamSelector() {
  if (document.getElementById("mtrStreamSelector")) {
    return;
  }

  const videos = document.getElementById("videos");

  if (!videos || !videos.parentElement) {
    return;
  }

  const selector = document.createElement("div");
  selector.id = "mtrStreamSelector";

  selector.innerHTML = `
    <div class="mtr-selector-title">
      📺 TRANSMISSÕES DISPONÍVEIS
    </div>

    <div id="mtrStreamButtons"></div>

    <button id="mtrStopWatching" type="button">
      ✕ Parar de assistir
    </button>
  `;

  videos.parentElement.insertBefore(
    selector,
    videos
  );

  document
    .getElementById("mtrStopWatching")
    .addEventListener("click", () => {
      mtrStopWatching();
    });
}

function mtrRefreshStreams() {
  mtrCreateStreamSelector();

  const container =
    document.getElementById("mtrStreamButtons");

  if (!container) {
    return;
  }

  container.innerHTML = "";

  const streams = mtrGetRemoteStreams();

  if (!streams.length) {
    const empty = document.createElement("span");

    empty.className = "mtr-no-stream";
    empty.textContent =
      "Ninguém está transmitindo agora.";

    container.appendChild(empty);
    return;
  }

  streams.forEach((card, index) => {
    if (!card.dataset.mtrStreamId) {
      card.dataset.mtrStreamId =
        "mtr-stream-" + index + "-" + Date.now();
    }

    const label =
      card.querySelector(".video-label");

    const name =
      label?.textContent?.replace(" • você", "") ||
      "Participante";

    const button =
      document.createElement("button");

    button.type = "button";
    button.className = "mtr-stream-button";

    if (
      mtrSelectedStream ===
      card.dataset.mtrStreamId
    ) {
      button.classList.add("active");
      button.textContent =
        "▶ Assistindo: " + name;
    } else {
      button.textContent =
        "Assistir " + name;
    }

    button.addEventListener("click", () => {
      mtrWatchStream(
        card.dataset.mtrStreamId
      );
    });

    container.appendChild(button);
  });

  mtrApplySelection();
}

function mtrWatchStream(id) {
  mtrSelectedStream = id;

  mtrApplySelection();
  mtrRefreshStreams();
}

function mtrStopWatching() {
  mtrSelectedStream = null;

  mtrApplySelection();
  mtrRefreshStreams();

  setMessage(
    "Você parou de assistir. Escolha outra transmissão quando quiser.",
    true
  );
}

function mtrApplySelection() {
  const streams = mtrGetRemoteStreams();

  streams.forEach((card) => {
    if (!mtrSelectedStream) {
      card.style.display = "none";
      return;
    }

    if (
      card.dataset.mtrStreamId ===
      mtrSelectedStream
    ) {
      card.style.display = "";
    } else {
      card.style.display = "none";
    }
  });

  const stopButton =
    document.getElementById("mtrStopWatching");

  if (stopButton) {
    stopButton.disabled =
      !mtrSelectedStream;
  }
}


/* =====================================================
   VISUAL
===================================================== */

const mtrSelectorStyle =
  document.createElement("style");

mtrSelectorStyle.textContent = `

#mtrStreamSelector {
  position: relative;
  z-index: 9999;

  margin-bottom: 12px;
  padding: 12px;

  border: 1px solid rgba(255,35,70,.45);
  border-radius: 12px;

  background: rgba(10,3,6,.94);
}

.mtr-selector-title {
  color: white;
  font-size: 12px;
  font-weight: 900;
  margin-bottom: 9px;
}

#mtrStreamButtons {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.mtr-stream-button,
#mtrStopWatching {
  padding: 9px 13px;

  border-radius: 8px;
  border: 1px solid #b51637;

  background: #16060a;
  color: white;

  font-weight: 800;
  cursor: pointer;
}

.mtr-stream-button:hover {
  background: #2b0911;
}

.mtr-stream-button.active {
  background:
    linear-gradient(
      135deg,
      #ff1748,
      #a40028
    );

  border-color: #ff3159;
}

#mtrStopWatching {
  margin-top: 9px;
  background: #090909;
}

#mtrStopWatching:hover {
  background: #26070e;
}

#mtrStopWatching:disabled {
  opacity: .4;
  cursor: default;
}

.mtr-no-stream {
  color: rgba(255,255,255,.55);
  font-size: 12px;
}

`;

document.head.appendChild(
  mtrSelectorStyle
);


/* =====================================================
   ATUALIZA AUTOMATICAMENTE
===================================================== */

const mtrVideoObserver =
  new MutationObserver(() => {

    setTimeout(
      mtrRefreshStreams,
      100
    );

  });

const mtrVideos =
  document.getElementById("videos");

if (mtrVideos) {
  mtrVideoObserver.observe(
    mtrVideos,
    {
      childList: true
    }
  );
}

mtrCreateStreamSelector();
mtrRefreshStreams();
