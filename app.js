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

      if (
        track.kind ===
        LK.Track.Kind.Video
      ) {
        attachVideo(
          track,
          participant
        );
      }

      if (
        track.kind ===
        LK.Track.Kind.Audio
      ) {

        const audio =
          track.attach();

        audio.autoplay = true;
        audio.controls = false;

        audio.volume =
          Number(
            $("volume")?.value || 75
          ) / 100;

        document.body.appendChild(
          audio
        );

        audio.play().catch(() => {

          console.log(
            "Áudio aguardando interação do usuário."
          );

          document.addEventListener(
            "click",
            () => {
              audio
                .play()
                .catch(() => {});
            },
            { once: true }
          );
        });

        console.log(
          "ÁUDIO DA TRANSMISSÃO RECEBIDO"
        );
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

function createLocalPreview(stream) {

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
  document.createElement("span");

chip.classList.add("person-chip");


/* AVATAR MTR */

const avatar =
  document.createElement("img");

avatar.src = "mtr-logo.png";
avatar.alt = "MTR";
avatar.classList.add("person-avatar");


/* NOME */

const name =
  document.createElement("span");

name.classList.add("person-name");


if (
  participant ===
  liveRoom.localParticipant
) {

  name.textContent =
    `${
      participant.name ||
      "Você"
    } (você)`;

} else {

  name.textContent =
    participant.name ||
    "Participante";

}


chip.appendChild(avatar);
chip.appendChild(name);

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
      "Escolha a tela ou janela que deseja compartilhar...",
      true
    );

    const stream =
      await navigator.mediaDevices
        .getDisplayMedia({
          video: {
            width: {
              ideal: width
            },

            height: {
              ideal: height
            },

            frameRate: {
              ideal: fps,
              max: fps
            }
          },

          audio: {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: false,
  suppressLocalAudioPlayback: false
},

systemAudio: "exclude",
selfBrowserSurface: "exclude",
surfaceSwitching: "exclude"
        });


    const videoTrack =
      stream.getVideoTracks()[0];

    const audioTrack =
      stream.getAudioTracks()[0];


    if (!videoTrack) {

      stream
        .getTracks()
        .forEach(
          track => track.stop()
        );

      throw new Error(
        "Nenhuma tela foi selecionada."
      );
    }


    localScreenStream =
      stream;


    /*
     * PUBLICAR VÍDEO
     */

    localScreenTrack =
      new LK.LocalVideoTrack(
        videoTrack
      );


    await liveRoom
      .localParticipant
      .publishTrack(
        localScreenTrack,
        {
          source:
            LK.Track.Source
              .ScreenShare,

          simulcast: true
        }
      );


    /*
     * PUBLICAR ÁUDIO DA TELA/JANELA
     */

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
                  .ScreenShareAudio
            }
          );


        console.log(
          "Áudio da tela publicado."
        );

      } catch (audioError) {

        console.warn(
          "Não foi possível publicar o áudio:",
          audioError
        );

        localScreenAudioTrack =
          null;
      }

    } else {

      localScreenAudioTrack =
        null;

      console.log(
        "A tela selecionada não forneceu áudio."
      );
    }


    createLocalPreview(
      stream
    );


    sharing = true;

    updateShareButton();


    const selectedWindow =
      $("selectedWindow");

    if (selectedWindow) {

      selectedWindow.textContent =
        videoTrack.label ||
        "Tela compartilhada";
    }


    setMessage(
      audioTrack
        ? "Transmitindo tela e áudio."
        : "Transmitindo tela. Para enviar o som, marque compartilhar áudio no seletor do navegador.",
      true
    );


    /*
     * SE A PESSOA CLICAR EM
     * "PARAR COMPARTILHAMENTO"
     * NO PRÓPRIO NAVEGADOR
     */

    videoTrack.addEventListener(
      "ended",
      () => {

        if (sharing) {
          stopScreenShare();
        }

      },
      {
        once: true
      }
    );


  } catch (error) {

    console.error(
      "Erro ao compartilhar tela:",
      error
    );


    setMessage(
      error?.message ||
      "Não foi possível compartilhar a tela.",
      true
    );


    sharing = false;

    updateShareButton();
  }
}


/* =====================================================
   PARAR COMPARTILHAMENTO
===================================================== */

async function stopScreenShare() {

  if (!liveRoom) {
    return;
  }


  try {

    if (localScreenTrack) {

      try {

        await liveRoom
          .localParticipant
          .unpublishTrack(
            localScreenTrack
          );

      } catch (error) {

        console.warn(
          "Erro ao remover vídeo:",
          error
        );
      }


      try {

        localScreenTrack.stop();
      } catch (_) {}

    }


    if (localScreenAudioTrack) {

      try {

        await liveRoom
          .localParticipant
          .unpublishTrack(
            localScreenAudioTrack
          );

      } catch (error) {

        console.warn(
          "Erro ao remover áudio:",
          error
        );
      }


      try {

        localScreenAudioTrack.stop();
      } catch (_) {}

    }


    if (localScreenStream) {

      localScreenStream
        .getTracks()
        .forEach(
          track => {

            try {
              track.stop();
            } catch (_) {}

          }
        );
    }


  } finally {

    localScreenTrack = null;
    localScreenAudioTrack = null;
    localScreenStream = null;

    sharing = false;

    removeLocalPreview();

    updateShareButton();


    if ($("selectedWindow")) {

      $("selectedWindow")
        .textContent =
          "Nenhuma janela selecionada";
    }


    setMessage(
      "Transmissão encerrada.",
      true
    );
  }
}


/* =====================================================
   CLIQUE NO BOTÃO COMPARTILHAR
===================================================== */

async function handleShareClick() {

  if (sharing) {

    await stopScreenShare();

  } else {

    await startScreenShare();
  }
}


if ($("share")) {

  $("share")
    .addEventListener(
      "click",
      handleShareClick
    );
}


/* =====================================================
   VOLUME
===================================================== */

function applyVolume() {

  const volume =
    Number(
      $("volume")?.value ||
      75
    ) / 100;


  document
    .querySelectorAll("audio")
    .forEach(
      audio => {

        audio.volume =
          Math.max(
            0,
            Math.min(
              1,
              volume
            )
          );

      }
    );


  document
    .querySelectorAll(
      "#videos video"
    )
    .forEach(
      video => {

        if (
          video.closest(
            '[data-local-preview="1"]'
          )
        ) {

          video.muted = true;

          return;
        }


        video.volume =
          Math.max(
            0,
            Math.min(
              1,
              volume
            )
          );

      }
    );
}


if ($("volume")) {

  $("volume")
    .addEventListener(
      "input",
      applyVolume
    );
}


/* =====================================================
   COPIAR CONVITE
===================================================== */

if ($("invite")) {

  $("invite")
    .addEventListener(
      "click",
      async () => {

        const url =
          `${location.origin}${location.pathname}?room=${encodeURIComponent(
            currentCode
          )}`;


        try {

          await navigator.clipboard
            .writeText(url);


          setMessage(
            "Link da sala copiado!",
            true
          );

        } catch (error) {

          console.error(
            "Erro copiando convite:",
            error
          );


          setMessage(
            url,
            true
          );
        }

      }
    );
}


/* =====================================================
   SAIR DA SALA
===================================================== */

if ($("leave")) {

  $("leave")
    .addEventListener(
      "click",
      async () => {

        try {

          if (sharing) {
            await stopScreenShare();
          }


          if (liveRoom) {
            await liveRoom.disconnect();
          }

        } catch (error) {

          console.warn(
            "Erro ao sair:",
            error
          );
        }


        liveRoom = null;
        currentCode = "";

        $("roomView")
          ?.classList
          .add("hidden");

        $("landing")
          ?.classList
          .remove("hidden");

        history.replaceState(
          {},
          "",
          location.pathname
        );

        setMessage(
          "Você saiu da sala."
        );
      }
    );
}


/* =====================================================
   CRIAR / ENTRAR
===================================================== */

if ($("create")) {

  $("create")
    .addEventListener(
      "click",
      () => enter(true)
    );
}


if ($("join")) {

  $("join")
    .addEventListener(
      "click",
      () => enter(false)
    );
}


/* =====================================================
   ENTER NOS CAMPOS
===================================================== */

$("name")
  ?.addEventListener(
    "keydown",
    event => {

      if (
        event.key === "Enter"
      ) {
        enter(false);
      }
    }
  );


$("roomCode")
  ?.addEventListener(
    "keydown",
    event => {

      if (
        event.key === "Enter"
      ) {
        enter(false);
      }
    }
  );


/* =====================================================
   PREENCHIMENTO INICIAL
===================================================== */

const savedName =
  localStorage.getItem(
    "mtrName"
  );


if (
  savedName &&
  $("name")
) {

  $("name").value =
    savedName;
}


const params =
  new URLSearchParams(
    location.search
  );


const roomFromUrl =
  normalizeRoom(
    params.get("room")
  );


if (
  roomFromUrl &&
  $("roomCode")
) {

  $("roomCode").value =
    roomFromUrl;
}


/* =====================================================
   ESTADO INICIAL
===================================================== */

updateShareButton();

applyVolume();


console.log(
  "MTR Stream carregado — botão de compartilhamento corrigido."
);


/* =====================================================
   MTR — ESCOLHER QUAL TRANSMISSÃO ASSISTIR
   CONTROLES NA LATERAL ESQUERDA
===================================================== */

let mtrSelectedStream = null;


/* =====================================================
   PEGAR TRANSMISSÕES DOS OUTROS
===================================================== */

function mtrGetRemoteStreams() {

  return Array.from(
    document.querySelectorAll(
      "#videos .video-card"
    )
  ).filter((card) => {

    return (
      card.dataset.localPreview !== "1"
    );

  });

}


/* =====================================================
   CRIAR CONTROLES NA LATERAL
===================================================== */

function mtrCreateStreamSelector() {

  if (
    document.getElementById(
      "mtrStreamSelector"
    )
  ) {
    return;
  }


  const sideContainer =
    document.getElementById(
      "streamControlsSide"
    );


  if (!sideContainer) {
    return;
  }


  const selector =
    document.createElement("div");


  selector.id =
    "mtrStreamSelector";


  selector.innerHTML = `

    <div id="mtrStreamButtons"></div>

    <button
      id="mtrStopWatching"
      type="button"
    >
      ✕ Parar de assistir
    </button>

  `;


  sideContainer.appendChild(
    selector
  );


  document
    .getElementById(
      "mtrStopWatching"
    )
    .addEventListener(
      "click",
      () => {

        mtrStopWatching();

      }
    );

}


/* =====================================================
   ATUALIZAR TRANSMISSÕES
===================================================== */

function mtrRefreshStreams() {

  mtrCreateStreamSelector();


  const container =
    document.getElementById(
      "mtrStreamButtons"
    );


  if (!container) {
    return;
  }


  container.innerHTML = "";


  const streams =
    mtrGetRemoteStreams();


  if (!streams.length) {

    const empty =
      document.createElement(
        "span"
      );


    empty.className =
      "mtr-no-stream";


    empty.textContent =
      "Ninguém está transmitindo agora.";


    container.appendChild(
      empty
    );


    mtrApplySelection();

    return;
  }


  streams.forEach(
    (card, index) => {


      if (
        !card.dataset.mtrStreamId
      ) {

        card.dataset.mtrStreamId =
          "mtr-stream-" +
          index +
          "-" +
          Date.now();

      }


      const label =
        card.querySelector(
          ".video-label"
        );


      const name =
        label
          ?.textContent
          ?.replace(
            " • você",
            ""
          ) ||
        "Participante";


      const button =
        document.createElement(
          "button"
        );


      button.type =
        "button";


      button.className =
        "mtr-stream-button";


      if (
        mtrSelectedStream ===
        card.dataset.mtrStreamId
      ) {

        button.classList.add(
          "active"
        );


        button.textContent =
          "▶ Assistindo: " +
          name;

      } else {

        button.textContent =
          "Assistir " +
          name;

      }


      button.addEventListener(
        "click",
        () => {

          mtrWatchStream(
            card.dataset.mtrStreamId
          );

        }
      );


      container.appendChild(
        button
      );

    }
  );


  mtrApplySelection();

}


/* =====================================================
   ASSISTIR TRANSMISSÃO
===================================================== */

function mtrWatchStream(id) {

  mtrSelectedStream = id;

  mtrApplySelection();

  mtrRefreshStreams();

}


/* =====================================================
   PARAR DE ASSISTIR
===================================================== */

function mtrStopWatching() {

  mtrSelectedStream = null;

  /* PARA O ÁUDIO/VÍDEO QUE ESTAVA SENDO ASSISTIDO */
  const videos = document.querySelectorAll("#videos video");
  const audios = document.querySelectorAll("#videos audio");

  videos.forEach((media) => {
    media.pause();
    media.muted = true;
    media.volume = 0;
  });

  audios.forEach((media) => {
    media.pause();
    media.muted = true;
    media.volume = 0;
  });

  mtrApplySelection();

  mtrRefreshStreams();

  setMessage(
    "Você parou de assistir. Escolha outra transmissão quando quiser.",
    true
  );
}


/* =====================================================
   MOSTRAR SOMENTE QUEM FOI ESCOLHIDO
===================================================== */

function mtrApplySelection() {
/* SILENCIA TODAS AS TRANSMISSÕES PRIMEIRO */
document
  .querySelectorAll("#videos video, #videos audio")
  .forEach((media) => {
    media.muted = true;
    media.volume = 0;
  });
  const streams =
    mtrGetRemoteStreams();


  streams.forEach(
    (card) => {


      const selected =
        mtrSelectedStream &&
        card.dataset.mtrStreamId ===
          mtrSelectedStream;


     if (selected) {

  card.style.display =
    "block";

  card.classList.add(
    "mtr-watching"
  );

  /* LIBERA O SOM SOMENTE DE QUEM VOCÊ ESTÁ ASSISTINDO */
  card
    .querySelectorAll("video, audio")
    .forEach((media) => {

      media.muted = false;

      const volume =
        document.getElementById("volume");

      media.volume =
        volume
          ? Number(volume.value) / 100
          : 0.75;

      media.play().catch(() => {});

    });

} else {

  card.style.display =
    "none";

  card.classList.remove(
    "mtr-watching"
  );

  /* DESLIGA O SOM DE QUEM VOCÊ NÃO ESTÁ ASSISTINDO */
  card
    .querySelectorAll("video, audio")
    .forEach((media) => {

      media.pause();
      media.muted = true;
      media.volume = 0;

    });

}

    }
  );


  /*
     NÃO MEXE NO PREVIEW DA PRÓPRIA PESSOA.
     ASSIM VOCÊ PODE ASSISTIR ALGUÉM
     E TRANSMITIR AO MESMO TEMPO.
  */


  const stopButton =
    document.getElementById(
      "mtrStopWatching"
    );


  if (stopButton) {

    stopButton.disabled =
      !mtrSelectedStream;

  }

}


/* =====================================================
   VISUAL DA LATERAL
===================================================== */

const mtrSelectorStyle =
  document.createElement(
    "style"
  );


mtrSelectorStyle.textContent = `

#mtrStreamSelector {

  width: 100%;

  margin: 0;

  padding: 0;

  background: transparent;

  border: 0;

  box-sizing: border-box;

}


#mtrStreamButtons {

  display: flex;

  flex-direction: column;

  width: 100%;

  gap: 8px;

}


.mtr-stream-button,
#mtrStopWatching {

  width: 100%;

  min-height: 40px;

  padding: 9px 12px;

  border-radius: 8px;

  border:
    1px solid #b51637;

  background:
    #16060a;

  color: white;

  font-weight: 800;

  cursor: pointer;

  box-sizing: border-box;

}


.mtr-stream-button:hover {

  background:
    #2b0911;

}


.mtr-stream-button.active {

  background:
    linear-gradient(
      135deg,
      #ff1748,
      #a40028
    );

  border-color:
    #ff3159;

}


#mtrStopWatching {

  margin-top: 8px;

  background:
    #090909;

}


#mtrStopWatching:hover {

  background:
    #26070e;

}


#mtrStopWatching:disabled {

  opacity: .4;

  cursor: default;

}


.mtr-no-stream {

  display: block;

  padding: 6px 0;

  color:
    rgba(
      255,
      255,
      255,
      .55
    );

  font-size: 12px;

}


/*
   A DIREITA FICA SÓ PARA O VÍDEO
*/

#videos {

  position: relative;

  z-index: 1;

  overflow: hidden;

}


#videos .video-card {

  position: relative;

  z-index: 1;

}


/*
   COMPARTILHAR TELA NA LATERAL
*/

.share-control-area {

  width: 100%;

  margin-top: 14px;

}


#share {

  width: 100%;

  position: relative;

  z-index: 20;

  pointer-events: auto;

}

`;


document.head.appendChild(
  mtrSelectorStyle
);


/* =====================================================
   DETECTAR QUANDO ALGUÉM COMEÇA/PARA
   DE TRANSMITIR
===================================================== */

const mtrVideoObserver =
  new MutationObserver(
    () => {

      setTimeout(
        mtrRefreshStreams,
        100
      );

    }
  );


const mtrVideos =
  document.getElementById(
    "videos"
  );


if (mtrVideos) {

  mtrVideoObserver.observe(
    mtrVideos,
    {
      childList: true
    }
  );

}


/* =====================================================
   INICIAR
===================================================== */

mtrCreateStreamSelector();

mtrRefreshStreams();
