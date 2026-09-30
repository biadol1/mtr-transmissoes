const $ = (id) => document.getElementById(id);
const LK = window.LivekitClient;

let liveRoom = null;
let currentCode = "";
let sharing = false;
let localScreenStream = null;
let localScreenTrack = null;
let localScreenAudioTrack = null;

let localCameraStream = null;
let localCameraTrack = null;
let cameraOn = false;


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

  const element =
    $(inRoom ? "roomMsg" : "msg");

  if (element) {
    element.textContent = text || "";
  }

}


/* =====================================================
   ENTRAR / CRIAR SALA
===================================================== */

async function enter(create) {

  const name =
    $("name").value.trim();

  let code =
    normalizeRoom(
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

    const response =
      await fetch(
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


    liveRoom =
      new LK.Room({
        adaptiveStream: true,
        dynacast: true,
      });


    bindRoomEvents(
      liveRoom
    );


    await liveRoom.connect(
      data.url,
      data.token
    );


    currentCode =
      data.room;


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


    $("landing")
      .classList
      .add("hidden");


    $("roomView")
      .classList
      .remove("hidden");


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


      /* =========================
         VÍDEO
      ========================= */

      if (
        track.kind ===
        LK.Track.Kind.Video
      ) {

        /*
          IMPORTANTE:

          Camera = webcam
          ScreenShare = compartilhamento de tela

          Assim webcam NÃO entra
          no sistema "Assistir".
        */

        const isCamera =
          publication?.source ===
          LK.Track.Source.Camera;


        attachVideo(
          track,
          participant,
          false,
          isCamera
            ? "camera"
            : "screen"
        );

      }


      /* =========================
         ÁUDIO
      ========================= */

      if (
        track.kind ===
        LK.Track.Kind.Audio
      ) {

        const audio =
          track.attach();


        audio.autoplay = false;
        audio.controls = false;


        /*
          Todo áudio remoto começa
          completamente silenciado.

          Ele só será liberado se
          você clicar em Assistir.
        */

        audio.muted = true;
        audio.volume = 0;


        audio.dataset.mtrParticipant =
          participant.identity;


        audio.dataset.mtrRemoteAudio =
          "1";


        /*
          PROCURA O CARD
          DA PESSOA
        */

        const participantId =
          participant.identity
            .replace(
              /[^a-zA-Z0-9_-]/g,
              ""
            );


        const participantCard =
          Array.from(
            document.querySelectorAll(
              "#videos .video-card"
            )
          ).find(
            (card) =>
              card.id.includes(
                participantId
              ) &&
              card.dataset.mtrType ===
                "screen"
          );


        if (participantCard) {

          participantCard
            .appendChild(audio);

        } else {

          /*
            Se o áudio chegar antes
            da tela, ele fica escondido
            e silenciado.
          */

          audio.style.display =
            "none";


          document.body
            .appendChild(audio);

        }


        audio.pause();
        audio.muted = true;
        audio.volume = 0;


        console.log(
          "Áudio remoto recebido e silenciado:",
          participant.name
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

          const card =
            element.closest(
              ".video-card"
            );

          if (card) {
            card.remove();
          } else {
            element.remove();
          }

        });

    } catch (error) {

      console.warn(
        "Erro removendo track:",
        error
      );

    }


    if (track.sid) {

      document
        .querySelectorAll(
          `[data-track-sid="${track.sid}"]`
        )
        .forEach((element) => {

          const card =
            element.closest(
              ".video-card"
            );

          if (card) {
            card.remove();
          } else {
            element.remove();
          }

        });

    }


    setTimeout(
      () => {

        mtrRefreshStreams();
        mtrApplySelection();
        updateStage();

      },
      100
    );

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
  local = false,
  type = "screen"
) {

  const participantId =
    participant?.identity ||
    "participant";


  const trackId =
    track.sid ||
    track.mediaStreamTrack?.id ||
    "video";


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
    document.createElement(
      "div"
    );


  wrap.className =
    "video-card";


  wrap.id =
    id;


  /*
    IDENTIFICA SE É:

    camera = WEBCAM
    screen = TELA
  */

  wrap.dataset.mtrType =
    type;


  if (type === "camera") {

    wrap.classList.add(
      "mtr-camera-card"
    );

  }


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


  /*
    WEBCAM NÃO TEM ÁUDIO.

    Preview local também
    permanece mutado.
  */

  if (
    local ||
    type === "camera"
  ) {

    video.muted = true;
    video.volume = 0;

  }


  const label =
    document.createElement(
      "div"
    );


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
    .appendChild(
      wrap
    );


  /*
    SOMENTE COMPARTILHAMENTO
    DE TELA RECEBE ÁUDIO.

    A webcam nunca pega
    o áudio remoto.
  */

  if (
    !local &&
    type === "screen" &&
    participant?.identity
  ) {

    document
      .querySelectorAll(
        'audio[data-mtr-remote-audio="1"]'
      )
      .forEach(
        (audio) => {

          if (
            audio.dataset
              .mtrParticipant ===
            participant.identity
          ) {

            wrap.appendChild(
              audio
            );


            audio.muted = true;
            audio.volume = 0;

          }

        }
      );

  }


  updateStage();

}


/* =====================================================
   PREVIEW LOCAL DA TELA
===================================================== */

function createLocalPreview(
  stream
) {

  /*
    Remove somente preview
    antigo da TELA.

    NÃO remove a webcam.
  */

  removeLocalPreview();


  const videoTrack =
    stream
      .getVideoTracks()[0];


  if (!videoTrack) {
    return;
  }


  const wrap =
    document.createElement(
      "div"
    );


  wrap.className =
    "video-card";


  wrap.dataset.localPreview =
    "1";


  wrap.dataset.mtrType =
    "screen";


  const video =
    document.createElement(
      "video"
    );


  video.srcObject =
    new MediaStream([
      videoTrack
    ]);


  video.autoplay = true;
  video.playsInline = true;
  video.muted = true;


  const label =
    document.createElement(
      "div"
    );


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
    .appendChild(
      wrap
    );


  updateStage();

}


/* =====================================================
   REMOVER PREVIEW LOCAL DA TELA
===================================================== */

function removeLocalPreview() {

  document
    .querySelectorAll(
      '[data-local-preview="1"][data-mtr-type="screen"]'
    )
    .forEach(
      (element) => {

        const video =
          element.querySelector(
            "video"
          );


        if (video) {

          video.srcObject =
            null;

        }


        element.remove();

      }
    );


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
    $("videos")
      .children
      .length > 0;


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


  $("people").innerHTML =
    "";


  participants.forEach(
    (participant) => {

      const chip =
        document.createElement(
          "span"
        );


      chip.classList.add(
        "person-chip"
      );


      /* AVATAR MTR */

      const avatar =
        document.createElement(
          "img"
        );


      avatar.src =
        "mtr-logo.png";

      avatar.alt =
        "MTR";

      avatar.classList.add(
        "person-avatar"
      );


      /* NOME */

      const name =
        document.createElement(
          "span"
        );


      name.classList.add(
        "person-name"
      );


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


      chip.appendChild(
        avatar
      );

      chip.appendChild(
        name
      );


      $("people")
        .appendChild(
          chip
        );

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


    /*
      COMPARTILHAMENTO DE TELA

      audio: true permite capturar
      o áudio quando o navegador
      disponibilizar essa opção.
    */

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

          audio: true

        });


    const videoTrack =
      stream
        .getVideoTracks()[0];


    const audioTrack =
      stream
        .getAudioTracks()[0];


    console.log(
      "🎵 Áudios capturados:",
      stream.getAudioTracks()
    );


    console.log(
      "🎵 audioTrack:",
      audioTrack
    );


    if (audioTrack) {

      console.log(
        "🎵 AUDIO ATIVO:",
        audioTrack.label,
        "enabled:",
        audioTrack.enabled,
        "muted:",
        audioTrack.muted,
        "readyState:",
        audioTrack.readyState
      );

    } else {

      console.log(
        "Nenhum áudio foi fornecido pelo navegador."
      );

    }


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


    /* =================================================
       PUBLICAR VÍDEO DA TELA
    ================================================= */

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


    /* =================================================
       PUBLICAR ÁUDIO DA TELA
    ================================================= */

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

    }


    /*
      MOSTRA A PRÓPRIA TELA
      LOCALMENTE.

      Isso é separado da webcam.
    */

    createLocalPreview(
      stream
    );


    sharing =
      true;


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
      SE CLICAR EM
      "PARAR COMPARTILHAMENTO"
      NA JANELA DO NAVEGADOR
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


    sharing =
      false;


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

    /* VÍDEO */

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


    /* ÁUDIO */

    if (
      localScreenAudioTrack
    ) {

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

        localScreenAudioTrack
          .stop();

      } catch (_) {}

    }


    /* STREAM ORIGINAL */

    if (localScreenStream) {

      localScreenStream
        .getTracks()
        .forEach(
          (track) => {

            try {

              track.stop();

            } catch (_) {}

          }
        );

    }


  } finally {

    localScreenTrack =
      null;

    localScreenAudioTrack =
      null;

    localScreenStream =
      null;


    sharing =
      false;


    /*
      REMOVE SOMENTE
      O PREVIEW DA TELA.

      A WEBCAM CONTINUA.
    */

    removeLocalPreview();


    updateShareButton();


    /*
      Se não estiver assistindo
      uma transmissão, garante
      que nenhum áudio de tela
      remota continue tocando.

      NÃO pausa webcams.
    */

    if (!mtrSelectedStream) {

      document
        .querySelectorAll(
          '#videos .video-card[data-mtr-type="screen"] video, #videos .video-card[data-mtr-type="screen"] audio'
        )
        .forEach(
          (media) => {

            media.pause();
            media.muted = true;
            media.volume = 0;

          }
        );

    }


    /*
      Reaplica:
      - webcams visíveis
      - transmissão escolhida
    */

    mtrApplySelection();


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
   WEBCAM
===================================================== */

function updateCameraButton() {

  const button =
    $("camera");


  if (!button) {
    return;
  }


  button.textContent =
    cameraOn
      ? "📷 Desligar webcam"
      : "📷 Ligar webcam";

}


/* =====================================================
   LIGAR WEBCAM
===================================================== */

async function startCamera() {

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
      .getUserMedia
  ) {

    setMessage(
      "Seu navegador não permite usar a webcam.",
      true
    );

    return;

  }


  try {

    setMessage(
      "Abrindo webcam...",
      true
    );


    /*
      SOMENTE CÂMERA.

      NÃO captura microfone.
    */

    localCameraStream =
      await navigator.mediaDevices
        .getUserMedia({

          video: {

            width: {
              ideal: 1280
            },

            height: {
              ideal: 720
            },

            frameRate: {
              ideal: 30
            }

          },

          audio: false

        });


    const videoTrack =
      localCameraStream
        .getVideoTracks()[0];


    if (!videoTrack) {

      throw new Error(
        "Nenhuma webcam encontrada."
      );

    }


    localCameraTrack =
      new LK.LocalVideoTrack(
        videoTrack
      );


    /*
      PUBLICA COMO CAMERA.

      Isso é o que permite
      diferenciar webcam de
      compartilhamento de tela.
    */

    await liveRoom
      .localParticipant
      .publishTrack(
        localCameraTrack,
        {

          source:
            LK.Track.Source.Camera,

          simulcast: true

        }
      );


    cameraOn =
      true;


    updateCameraButton();


    /*
      MOSTRA SUA PRÓPRIA
      WEBCAM NA GRADE.
    */

    attachVideo(
      localCameraTrack,
      liveRoom.localParticipant,
      true,
      "camera"
    );


    /*
      Reorganiza a tela.
    */

    mtrApplySelection();


    setMessage(
      "Webcam ligada.",
      true
    );


  } catch (error) {

    console.error(
      "Erro ao ligar webcam:",
      error
    );


    if (localCameraStream) {

      localCameraStream
        .getTracks()
        .forEach(
          (track) => {

            try {

              track.stop();

            } catch (_) {}

          }
        );

    }


    localCameraStream =
      null;

    localCameraTrack =
      null;

    cameraOn =
      false;


    updateCameraButton();


    setMessage(
      "Não foi possível abrir a webcam.",
      true
    );

  }

}


/* =====================================================
   DESLIGAR WEBCAM
===================================================== */

async function stopCamera() {

  try {

    if (
      liveRoom &&
      localCameraTrack
    ) {

      try {

        await liveRoom
          .localParticipant
          .unpublishTrack(
            localCameraTrack
          );

      } catch (error) {

        console.warn(
          "Erro ao remover webcam:",
          error
        );

      }

    }


    if (localCameraTrack) {

      try {

        localCameraTrack
          .stop();

      } catch (_) {}

    }


    if (localCameraStream) {

      localCameraStream
        .getTracks()
        .forEach(
          (track) => {

            try {

              track.stop();

            } catch (_) {}

          }
        );

    }


  } finally {

    /*
      REMOVE SOMENTE O CARD
      DA WEBCAM LOCAL.

      Não remove a transmissão
      de tela.
    */

    document
      .querySelectorAll(
        '#videos .video-card[data-local-preview="1"][data-mtr-type="camera"]'
      )
      .forEach(
        (card) => {

          card.remove();

        }
      );


    localCameraTrack =
      null;

    localCameraStream =
      null;

    cameraOn =
      false;


    updateStage();

    updateCameraButton();

    mtrApplySelection();


    setMessage(
      "Webcam desligada.",
      true
    );

  }

}


/* =====================================================
   BOTÃO WEBCAM
===================================================== */

async function handleCameraClick() {

  if (cameraOn) {

    await stopCamera();

  } else {

    await startCamera();

  }

}


if ($("camera")) {

  $("camera")
    .addEventListener(
      "click",
      handleCameraClick
    );

}


updateCameraButton();


/* =====================================================
   VOLUME
===================================================== */

function applyVolume() {

  const volume =
    Number(
      $("volume")?.value ||
      75
    ) / 100;


  /*
    ÁUDIOS REMOTOS.

    Só alteramos volume.
    Quem decide se pode tocar
    é mtrApplySelection().
  */

  document
    .querySelectorAll(
      "audio"
    )
    .forEach(
      (audio) => {

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


  /*
    VÍDEOS.

    Webcam continua mutada.
    Preview local continua mutado.
  */

  document
    .querySelectorAll(
      "#videos video"
    )
    .forEach(
      (video) => {

        const card =
          video.closest(
            ".video-card"
          );


        if (
          card?.dataset
            .localPreview === "1" ||
          card?.dataset
            .mtrType === "camera"
        ) {

          video.muted =
            true;

          video.volume =
            0;

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
      () => {

        applyVolume();

        /*
          Reaplica a seleção
          para não liberar áudio
          de quem não está sendo
          assistido.
        */

        mtrApplySelection();

      }
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

          await navigator
            .clipboard
            .writeText(
              url
            );


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

          /*
            DESLIGA WEBCAM
            ANTES DE SAIR.
          */

          if (cameraOn) {

            await stopCamera();

          }


          /*
            PARA TRANSMISSÃO.
          */

          if (sharing) {

            await stopScreenShare();

          }


          if (liveRoom) {

            await liveRoom
              .disconnect();

          }


        } catch (error) {

          console.warn(
            "Erro ao sair:",
            error
          );

        }


        liveRoom =
          null;

        currentCode =
          "";


        $("roomView")
          ?.classList
          .add(
            "hidden"
          );


        $("landing")
          ?.classList
          .remove(
            "hidden"
          );


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
    (event) => {

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
    (event) => {

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


/* =====================================================
   SALA PELO LINK
===================================================== */

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
   MODO CONVITE

   Se entrar pelo link da sala:
   - esconde Criar sala
   - deixa somente Entrar na sala
===================================================== */

if (roomFromUrl) {

  const createButton =
    document.getElementById(
      "create"
    );


  if (createButton) {

    createButton.style.display =
      "none";

  }


  const joinButton =
    document.getElementById(
      "join"
    );


  if (joinButton) {

    joinButton.textContent =
      "Entrar na sala";

  }

}


/* =====================================================
   ESTADO INICIAL
===================================================== */

updateShareButton();

applyVolume();


console.log(
  "MTR Stream carregado."
);


/* =====================================================
   MTR — ESCOLHER QUAL TRANSMISSÃO ASSISTIR
===================================================== */

let mtrSelectedStream =
  null;


/* =====================================================
   PEGAR SOMENTE COMPARTILHAMENTOS DE TELA

   WEBCAM NÃO ENTRA NESTA LISTA
===================================================== */

function mtrGetRemoteStreams() {

  return Array.from(
    document.querySelectorAll(
      "#videos .video-card"
    )
  ).filter(
    (card) => {

      return (

        card.dataset
          .localPreview !== "1" &&

        card.dataset
          .mtrType !== "camera"

      );

    }
  );

}


/* =====================================================
   CRIAR CONTROLES NA LATERAL
===================================================== */

function mtrCreateStreamSelector() {

  /*
    Se já existe,
    não cria novamente.
  */

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
    document.createElement(
      "div"
    );


  selector.id =
    "mtrStreamSelector";


  selector.innerHTML = `

    <div
      id="mtrStreamButtons"
    ></div>

    <button
      id="mtrStopWatching"
      type="button"
    >
      ✕ Parar de assistir
    </button>

  `;


  sideContainer
    .appendChild(
      selector
    );


  const stopButton =
    document.getElementById(
      "mtrStopWatching"
    );


  if (stopButton) {

    stopButton
      .addEventListener(
        "click",
        () => {

          mtrStopWatching();

        }
      );

  }

}


/* =====================================================
   ATUALIZAR LISTA DE TRANSMISSÕES
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


  container.innerHTML =
    "";


  /*
    Aqui entram somente
    compartilhamentos de tela.

    Webcams ficam fora.
  */

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

      /*
        Dá um ID próprio
        para cada transmissão.
      */

      if (
        !card.dataset
          .mtrStreamId
      ) {

        card.dataset
          .mtrStreamId =
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


      /*
        DESTACA QUEM
        ESTÁ SENDO ASSISTIDO.
      */

      if (
        mtrSelectedStream ===
        card.dataset
          .mtrStreamId
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
            card.dataset
              .mtrStreamId
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

  mtrSelectedStream =
    id;


  mtrApplySelection();

  mtrRefreshStreams();

}


/* =====================================================
   PARAR DE ASSISTIR
===================================================== */

function mtrStopWatching() {

  mtrSelectedStream =
    null;


  /*
    Para SOMENTE os vídeos/áudios
    de compartilhamento de tela.

    WEBCAMS CONTINUAM VISÍVEIS.
  */

  document
    .querySelectorAll(
      '#videos .video-card[data-mtr-type="screen"] video, #videos .video-card[data-mtr-type="screen"] audio'
    )
    .forEach(
      (media) => {

        media.pause();

        media.muted =
          true;

        media.volume =
          0;

      }
    );


  mtrApplySelection();

  mtrRefreshStreams();


  setMessage(
    "Você parou de assistir. Escolha outra transmissão quando quiser.",
    true
  );

}


/* =====================================================
   MOSTRAR WEBCAMS + TRANSMISSÃO ESCOLHIDA
===================================================== */

function mtrApplySelection() {

  /* ==========================================
     WEBCAMS
     Todas ficam visíveis automaticamente
  ========================================== */

  const cameras =
    Array.from(
      document.querySelectorAll(
        '#videos .video-card[data-mtr-type="camera"]'
      )
    );


  cameras.forEach((card, index) => {

    card.style.display = "block";

    if (mtrSelectedStream) {

  card.style.setProperty("position", "absolute", "important");
  card.style.setProperty("width", "150px", "important");
  card.style.setProperty("height", "90px", "important");
  card.style.setProperty("min-width", "150px", "important");
  card.style.setProperty("min-height", "90px", "important");
  card.style.setProperty("max-width", "150px", "important");
  card.style.setProperty("max-height", "90px", "important");

  card.style.setProperty("right", "25px", "important");
  card.style.setProperty(
    "top",
    `${25 + (index * 100)}px`,
    "important"
  );

  card.style.setProperty("left", "auto", "important");
  card.style.setProperty("bottom", "auto", "important");
  card.style.setProperty("margin", "0", "important");
  card.style.setProperty("z-index", "100", "important");

} else {

  /* VOLTA AO NORMAL QUANDO NÃO ESTIVER TELANDO */

  card.style.removeProperty("position");
  card.style.removeProperty("width");
  card.style.removeProperty("height");
  card.style.removeProperty("min-width");
  card.style.removeProperty("min-height");
  card.style.removeProperty("max-width");
  card.style.removeProperty("max-height");
  card.style.removeProperty("right");
  card.style.removeProperty("top");
  card.style.removeProperty("left");
  card.style.removeProperty("bottom");
  card.style.removeProperty("margin");
  card.style.removeProperty("z-index");

}
     
    card.classList.add(
      "mtr-camera-card"
    );

    card.classList.remove(
      "mtr-watching"
    );


    /* VÍDEO DA WEBCAM */

    card
      .querySelectorAll("video")
      .forEach((video) => {

        video.muted = true;
        video.volume = 0;

        video
          .play()
          .catch(() => {});

      });


    /* WEBCAM NÃO USA ÁUDIO */

    card
      .querySelectorAll("audio")
      .forEach((audio) => {

        audio.pause();
        audio.muted = true;
        audio.volume = 0;

      });

  });


  /* ==========================================
     INFORMA QUANTAS WEBCAMS ESTÃO NA TELA
  ========================================== */

  const videos =
    document.getElementById(
      "videos"
    );


 if (videos) {

  videos.dataset.cameraCount =
    String(cameras.length);

  // Ativa tela + webcams
  if (mtrSelectedStream) {

    videos.classList.add(
      "mtr-screen-active"
    );

  } else {

    videos.classList.remove(
      "mtr-screen-active"
    );

  }

}
  /* ==========================================
     COMPARTILHAMENTOS DE TELA
  ========================================== */

  const streams =
    mtrGetRemoteStreams();


  streams.forEach((card) => {

    const selected =
      mtrSelectedStream &&
      card.dataset.mtrStreamId ===
        mtrSelectedStream;


    /* TRANSMISSÃO ESCOLHIDA */

    if (selected) {

      card.style.display =
        "block";

      card.classList.add(
        "mtr-watching"
      );


      card
        .querySelectorAll(
          "video, audio"
        )
        .forEach((media) => {

          media.muted =
            false;


          const volume =
            document.getElementById(
              "volume"
            );


          media.volume =
            volume
              ? Number(
                  volume.value
                ) / 100
              : 0.75;


          media
            .play()
            .catch(() => {});

        });


    /* OUTRAS TRANSMISSÕES */

    } else {

      card.style.display =
        "none";

      card.classList.remove(
        "mtr-watching"
      );


      card
        .querySelectorAll(
          "video, audio"
        )
        .forEach((media) => {

          media.pause();

          media.muted =
            true;

          media.volume =
            0;

        });

    }

  });


  /* ==========================================
     BOTÃO PARAR DE ASSISTIR
  ========================================== */

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
   VISUAL DA LATERAL + WEBCAMS
===================================================== */

const mtrSelectorStyle =
  document.createElement(
    "style"
  );


mtrSelectorStyle.textContent = `

/* =====================================================
   CONTROLE DAS TRANSMISSÕES
===================================================== */

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


/* =====================================================
   ÁREA DOS VÍDEOS
===================================================== */

#videos {

  position: relative;

  z-index: 1;

  overflow: hidden;

}


#videos .video-card {

  position: relative;

  z-index: 1;

}


/* =====================================================
   WEBCAMS — TAMANHO BONITO ATÉ 6
===================================================== */

#videos[data-camera-count="1"],
#videos[data-camera-count="2"],
#videos[data-camera-count="3"],
#videos[data-camera-count="4"],
#videos[data-camera-count="5"],
#videos[data-camera-count="6"] {

  display: grid !important;

  width: 100% !important;
  height: 100% !important;

  gap: 12px !important;
  padding: 18px !important;

  box-sizing: border-box !important;

  justify-content: center !important;
  align-content: center !important;

  overflow: hidden !important;
}


/* =====================================================
   1 WEBCAM
===================================================== */

#videos[data-camera-count="1"] {

  grid-template-columns:
    minmax(0, 850px) !important;

  grid-template-rows:
    minmax(0, 480px) !important;

}


/* =====================================================
   2 WEBCAMS
===================================================== */

#videos[data-camera-count="2"] {

  grid-template-columns:
    repeat(2, minmax(0, 650px)) !important;

  grid-template-rows:
    minmax(0, 400px) !important;

}


/* =====================================================
   3 E 4 WEBCAMS
===================================================== */

#videos[data-camera-count="3"],
#videos[data-camera-count="4"] {

  grid-template-columns:
    repeat(2, minmax(0, 560px)) !important;

  grid-template-rows:
    repeat(2, minmax(0, 300px)) !important;

}


/* =====================================================
   5 E 6 WEBCAMS
===================================================== */

#videos[data-camera-count="5"],
#videos[data-camera-count="6"] {

  grid-template-columns:
    repeat(3, minmax(0, 430px)) !important;

  grid-template-rows:
    repeat(2, minmax(0, 270px)) !important;

}


/* =====================================================
   CARD DA WEBCAM
===================================================== */

#videos .mtr-camera-card {

  display: block !important;

  position: relative !important;

  width: 100% !important;
  height: 100% !important;

  min-width: 0 !important;
  min-height: 0 !important;

  margin: 0 !important;

  overflow: hidden !important;

  border-radius: 14px !important;

  background: #050505 !important;

  border:
    1px solid
    rgba(255, 35, 75, .45) !important;

  box-sizing: border-box !important;

}


/* =====================================================
   VÍDEO DA WEBCAM
===================================================== */

#videos .mtr-camera-card video {

  display: block !important;

  width: 100% !important;
  height: 100% !important;

  min-width: 0 !important;
  min-height: 0 !important;

  max-width: 100% !important;
  max-height: 100% !important;

  object-fit: cover !important;

  background: #050505 !important;

}


/* =====================================================
   NOME DA PESSOA
===================================================== */

#videos
.mtr-camera-card
.video-label {

  position: absolute;

  left: 12px;
  bottom: 12px;

  z-index: 5;

  padding: 7px 11px;

  border-radius: 999px;

  background:
    rgba(0, 0, 0, .72);

  color: #ffffff;

  font-size: 12px;
  font-weight: 800;

  pointer-events: none;

}


/* =====================================================
   CELULAR
===================================================== */

@media (max-width: 700px) {

  #videos[data-camera-count="1"],
  #videos[data-camera-count="2"],
  #videos[data-camera-count="3"],
  #videos[data-camera-count="4"],
  #videos[data-camera-count="5"],
  #videos[data-camera-count="6"] {

    grid-template-columns:
      1fr !important;

    grid-template-rows:
      none !important;

    grid-auto-rows:
      220px !important;

    overflow-y:
      auto !important;

    padding: 8px !important;

  }

}
/* =====================================================
   TRANSMISSÃO QUE ESTÁ SENDO ASSISTIDA
===================================================== */

#videos
.video-card.mtr-watching {

  width:
    100%;

  height:
    100%;

}


#videos
.video-card.mtr-watching
video {

  width:
    100%;

  height:
    100%;

  object-fit:
    contain;

}


/* =====================================================
   BOTÃO COMPARTILHAR
===================================================== */

.share-control-area {

  width:
    100%;

  margin-top:
    14px;

}


#share {

  width:
    100%;

  position:
    relative;

  z-index:
    20;

  pointer-events:
    auto;

}


/* =====================================================
   BOTÃO WEBCAM
===================================================== */

#camera {

  width:
    100%;

  position:
    relative;

  z-index:
    20;

  pointer-events:
    auto;

  margin-top:
    8px;

}
/* =====================================================
   TELA COMPARTILHADA + WEBCAMS
===================================================== */

#videos.mtr-screen-active {

  display: block !important;

  position: relative !important;

  width: 100% !important;
  height: 100% !important;

  padding: 12px !important;

  box-sizing: border-box !important;

  overflow: hidden !important;
}


/* =====================================================
   TELA COMPARTILHADA GRANDE
===================================================== */

#videos.mtr-screen-active
.video-card.mtr-watching:not(.mtr-camera-card) {

  display: block !important;

  position: absolute !important;

  top: 12px !important;
  left: 12px !important;
  right: 12px !important;
  bottom: 12px !important;

  width: auto !important;
  height: auto !important;

  margin: 0 !important;

  z-index: 1 !important;

  overflow: hidden !important;

  border-radius: 14px !important;

  background: #050505 !important;
}


#videos.mtr-screen-active
.video-card.mtr-watching:not(.mtr-camera-card)
video {

  display: block !important;

  width: 100% !important;
  height: 100% !important;

  object-fit: contain !important;

  background: #050505 !important;
}

/* =====================================================
   WEBCAMS PEQUENAS SOBRE A TRANSMISSÃO
===================================================== */

#videos.mtr-screen-active .mtr-camera-card {
  display: block !important;

  position: absolute !important;

  width: 150px !important;
  height: 90px !important;

  min-width: 150px !important;
  min-height: 90px !important;

  max-width: 150px !important;
  max-height: 90px !important;

  margin: 0 !important;

  right: 25px !important;

  z-index: 100 !important;

  overflow: hidden !important;

  border-radius: 10px !important;

  background: #050505 !important;

  border: 2px solid #ff234b !important;

  box-shadow: 0 5px 18px rgba(0,0,0,.75) !important;

  float: none !important;
  transform: none !important;

  grid-column: auto !important;
  grid-row: auto !important;
}


/* WEBCAM 1 */
#videos.mtr-screen-active .mtr-camera-card:nth-of-type(1) {
  top: 25px !important;
}

/* WEBCAM 2 */
#videos.mtr-screen-active .mtr-camera-card:nth-of-type(2) {
  top: 125px !important;
}

/* WEBCAM 3 */
#videos.mtr-screen-active .mtr-camera-card:nth-of-type(3) {
  top: 225px !important;
}

/* WEBCAM 4 */
#videos.mtr-screen-active .mtr-camera-card:nth-of-type(4) {
  top: 325px !important;
}

/* WEBCAM 5 */
#videos.mtr-screen-active .mtr-camera-card:nth-of-type(5) {
  top: 425px !important;
}

/* WEBCAM 6 */
#videos.mtr-screen-active .mtr-camera-card:nth-of-type(6) {
  top: 525px !important;
}


/* VÍDEO DENTRO DA WEBCAM */

#videos.mtr-screen-active .mtr-camera-card video {
  display: block !important;

  width: 100% !important;
  height: 100% !important;

  min-width: 0 !important;
  min-height: 0 !important;

  max-width: 100% !important;
  max-height: 100% !important;

  object-fit: cover !important;
}


/* NOME DA PESSOA */

#videos.mtr-screen-active .mtr-camera-card .video-label {
  left: 7px !important;
  bottom: 7px !important;

  padding: 4px 7px !important;

  font-size: 10px !important;
}

/* =====================================================
   CELULAR
===================================================== */

@media (max-width: 700px) {

  #videos.mtr-screen-active
  .mtr-camera-card {

    width: 120px !important;
    height: 72px !important;

    min-width: 120px !important;
    min-height: 72px !important;

  }

}

`;


/* COLOCA O CSS NA PÁGINA */

document.head.appendChild(
  mtrSelectorStyle
);


/* =====================================================
   DETECTAR QUANDO ALGUÉM COMEÇA/PARA
   DE TRANSMITIR OU LIGA/DESLIGA WEBCAM
===================================================== */

const mtrVideoObserver =
  new MutationObserver(
    () => {

      /*
        Dá um pequeno tempo
        para o LiveKit terminar
        de criar/remover o card.
      */

      setTimeout(
        () => {

          mtrRefreshStreams();

          mtrApplySelection();

          updateStage();

        },
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

      childList:
        true

    }
  );

}


/* =====================================================
   ATUALIZAR QUANDO A JANELA MUDA DE TAMANHO
===================================================== */

window.addEventListener(
  "resize",
  () => {

    updateStage();

  }
);


/* =====================================================
   INICIAR CONTROLES MTR
===================================================== */

mtrCreateStreamSelector();

mtrRefreshStreams();

mtrApplySelection();


console.log(
  "MTR Stream pronto — tela e webcams separadas."
);
