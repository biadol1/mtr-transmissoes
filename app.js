const $ = (id) => document.getElementById(id);
const LK = window.LivekitClient;

let liveRoom = null;
let currentCode = "";
let sharing = false;

const MAX_PARTICIPANTS = 6;


/* =====================================================
   UTILIDADES
===================================================== */

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
    return setMessage(
      "Coloque seu nome para continuar."
    );
  }

  if (create && !code) {
    code = roomCode();
  }

  if (!code) {
    return setMessage(
      "Digite o código da sala."
    );
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
          "Não foi possível entrar na sala."
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

    if ($("roomTitle")) {
      $("roomTitle").textContent =
        `Sala ${currentCode}`;
    }

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

  } catch (error) {
    console.error(
      "ERRO AO ENTRAR:",
      error
    );

    setMessage(
      error.message ||
        "Erro ao conectar à sala."
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

  /* RECEBER VÍDEO DE OUTRA PESSOA */

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
          participant,
          false
        );
      }

      updatePeople();
      updateStage();
    }
  );


  /* VÍDEO REMOVIDO */

  room.on(
    LK.RoomEvent.TrackUnsubscribed,
    (track) => {

      track
        .detach()
        .forEach((element) => {
          element.remove();
        });

      removeEmptyVideoCards();

      updateStage();
    }
  );


  /* PESSOA ENTROU */

  room.on(
    LK.RoomEvent.ParticipantConnected,
    () => {
      updatePeople();
    }
  );


  /* PESSOA SAIU */

  room.on(
    LK.RoomEvent.ParticipantDisconnected,
    () => {
      updatePeople();

      removeEmptyVideoCards();

      updateStage();
    }
  );


  /* MINHA TELA COMEÇOU A SER TRANSMITIDA */

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


  /* MINHA TELA PAROU */

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


  /* DESCONECTOU */

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


/* =====================================================
   MOSTRAR VÍDEO
===================================================== */

function attachVideo(
  track,
  participant,
  local = false
) {

  const rawId =
    `video-${participant.identity}-${track.sid || "screen"}`;

  const id =
    rawId.replace(
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

  if (local) {
    wrap.dataset.localPreview =
      "1";
  }


  const video =
    track.attach();

  video.autoplay = true;
  video.playsInline = true;


  /*
    Evita eco para quem
    está transmitindo
  */

  if (local) {
    video.muted = true;
  }


  const label =
    document.createElement("div");

  label.className =
    "video-label";

  label.textContent =
    `${participant.name || "Participante"}${
      local ? " • você" : ""
    }`;


  wrap.append(
    video,
    label
  );


  $("videos").appendChild(
    wrap
  );

  updateStage();
}


/* =====================================================
   REMOVER PREVIEW LOCAL
===================================================== */

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


/* =====================================================
   LIMPAR CARDS VAZIOS
===================================================== */

function removeEmptyVideoCards() {

  document
    .querySelectorAll(
      ".video-card"
    )
    .forEach((card) => {

      if (
        !card.querySelector(
          "video"
        )
      ) {
        card.remove();
      }

    });
}


/* =====================================================
   ATUALIZAR PALCO
===================================================== */

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

  $("emptyStage")
    .classList
    .toggle(
      "hidden",
      !!hasVideo
    );
}


/* =====================================================
   LISTA DE PESSOAS
===================================================== */

function updatePeople() {

  if (!liveRoom) {
    return;
  }

  const all = [
    liveRoom.localParticipant,
    ...liveRoom
      .remoteParticipants
      .values(),
  ];


  /* CONTADOR DO TOPO */

  if ($("count")) {
    $("count").textContent =
      `👥 ${all.length}/${MAX_PARTICIPANTS} assistindo`;
  }


  /* CONTADOR DA LATERAL */

  if ($("sideCount")) {
    $("sideCount").textContent =
      `${all.length}/${MAX_PARTICIPANTS}`;
  }


  if (!$("people")) {
    return;
  }


  $("people").innerHTML = "";


  all.forEach(
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
          `${participant.name || "Você"} (você)`;

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
   BOTÕES CRIAR / ENTRAR
===================================================== */

$("create").onclick =
  () => enter(true);


$("join").onclick =
  () => enter(false);


/* =====================================================
   COMPARTILHAR TELA
===================================================== */

$("share").onclick =
  async () => {

    if (!liveRoom) {

      setMessage(
        "Você ainda não está conectado à sala.",
        true
      );

      return;
    }


    setMessage("", true);


    /* =============================================
       SE JÁ ESTIVER TRANSMITINDO:
       PARA A TRANSMISSÃO
    ============================================= */

    if (
      liveRoom
        .localParticipant
        .isScreenShareEnabled
    ) {

      try {

        await liveRoom
          .localParticipant
          .setScreenShareEnabled(
            false
          );


        sharing = false;


        $("share").textContent =
          "🖥 Compartilhar tela";


        removeLocalPreview();

        updateStage();


        setMessage(
          "Transmissão encerrada.",
          true
        );


      } catch (error) {

        console.error(
          "ERRO AO PARAR:",
          error
        );


        setMessage(
          "Não foi possível parar a transmissão.",
          true
        );
      }


      return;
    }


    /* =============================================
       INICIAR COMPARTILHAMENTO

       O NAVEGADOR DEVE ABRIR
       O SELETOR DE TELA/JANELA
    ============================================= */

    try {

      setMessage(
        "Escolha a tela ou janela que deseja compartilhar.",
        true
      );


      /*
        IMPORTANTE:

        Não forçamos áudio aqui.

        Isso permite que o navegador
        abra normalmente o seletor
        de compartilhamento.
      */

      await liveRoom
        .localParticipant
        .setScreenShareEnabled(
          true
        );


      sharing = true;


      $("share").textContent =
        "⏹ Parar transmissão";


      setMessage(
        "Sua tela está sendo compartilhada.",
        true
      );


      updateStage();


    } catch (error) {

      console.error(
        "ERRO AO COMPARTILHAR TELA:",
        error
      );


      sharing = false;


      $("share").textContent =
        "🖥 Compartilhar tela";


      /*
        Agora mostramos o erro
        verdadeiro na própria página.
      */

      const errorName =
        error?.name ||
        "Erro";


      const errorMessage =
        error?.message ||
        "Erro desconhecido";


      setMessage(
        `Erro ao compartilhar: ${errorName} - ${errorMessage}`,
        true
      );
    }
  };


/* =====================================================
   COPIAR CONVITE
===================================================== */

$("invite").onclick =
  async () => {

    const url =
      `${location.origin}${location.pathname}` +
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


    } catch (error) {

      setMessage(
        `Convite: ${url}`,
        true
      );
    }
  };


/* =====================================================
   VOLUME
===================================================== */

if ($("volume")) {

  $("volume")
    .addEventListener(
      "input",
      (event) => {

        const volume =
          Number(
            event.target.value
          ) / 100;


        document
          .querySelectorAll(
            "#videos video"
          )
          .forEach(
            (video) => {

              /*
                Não mexemos no
                preview local.
              */

              if (!video.muted) {
                video.volume =
                  volume;
              }
            }
          );
      }
    );
}


/* =====================================================
   SAIR DA SALA
===================================================== */

$("leave").onclick =
  async () => {

    try {

      if (liveRoom) {

        if (
          liveRoom
            .localParticipant
            .isScreenShareEnabled
        ) {

          await liveRoom
            .localParticipant
            .setScreenShareEnabled(
              false
            )
            .catch(() => {});
        }


        await liveRoom.disconnect();
      }


    } finally {

      location.href =
        location.pathname;
    }
  };


/* =====================================================
   FECHAR / ATUALIZAR PÁGINA
===================================================== */

window.addEventListener(
  "beforeunload",
  () => {

    if (liveRoom) {
      liveRoom.disconnect();
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
   CONVITE RECEBIDO PELO LINK
===================================================== */

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
