const $ = (id) => document.getElementById(id);
const LK = window.LivekitClient;

let liveRoom = null;
let currentCode = "";
let sharing = false;
let screenTracks = [];

function roomCode() {
  return "MTR-" + Math.random().toString(36).slice(2, 7).toUpperCase();
}

function normalizeRoom(value) {
  return value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, "")
    .slice(0, 32);
}

function setMessage(text, inRoom = false) {
  const el = $(inRoom ? "roomMsg" : "msg");
  if (el) el.textContent = text || "";
}

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

    $("status").textContent = "ONLINE";

    setMessage("");

    updatePeople();
    updateStage();

  } catch (err) {
    console.error(err);

    setMessage(
      err.message || "Erro ao conectar."
    );

  } finally {
    $("create").disabled = false;
    $("join").disabled = false;
  }
}


/* ===============================
   EVENTOS LIVEKIT
================================ */

function bindRoomEvents(room) {

  room.on(
    LK.RoomEvent.TrackSubscribed,
    (track, publication, participant) => {

      if (track.kind === LK.Track.Kind.Video) {
        attachVideo(track, participant);
      }

      updatePeople();
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
      updateStage();
    }
  );


  room.on(
    LK.RoomEvent.Disconnected,
    () => {

      $("status").textContent = "OFFLINE";

      sharing = false;

      if ($("share")) {
        $("share").textContent = "🖥 Compartilhar tela";
      }
    }
  );
}


/* ===============================
   VÍDEO
================================ */

function attachVideo(track, participant, local = false) {

  const identity =
    participant?.identity ||
    "participant";

  const sid =
    track?.sid ||
    Math.random().toString(36).slice(2);

  const id =
    `video-${identity}-${sid}`
      .replace(/[^a-zA-Z0-9_-]/g, "");

  if ($(id)) return;


  const wrap = document.createElement("div");

  wrap.className = "video-card";
  wrap.id = id;


  if (local) {
    wrap.dataset.localPreview = "1";
  }


  const video = track.attach();

  video.autoplay = true;
  video.playsInline = true;


  const label =
    document.createElement("div");

  label.className = "video-label";

  label.textContent =
    `${participant?.name || "Participante"}${
      local ? " • você" : ""
    }`;


  wrap.appendChild(video);
  wrap.appendChild(label);

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

      if (!card.querySelector("video")) {
        card.remove();
      }

    });
}


/* ===============================
   PALCO
================================ */

function updateStage() {

  const hasVideo =
    $("videos").children.length > 0;

  $("emptyStage").classList.toggle(
    "hidden",
    hasVideo
  );

}


/* ===============================
   PARTICIPANTES
================================ */

function updatePeople() {

  if (!liveRoom) return;


  const all = [
    liveRoom.localParticipant,
    ...liveRoom.remoteParticipants.values(),
  ];


  const total = all.length;


  $("count").textContent =
    `${total}/6 assistindo`;


  const sideCount =
    $("sideCount");

  if (sideCount) {
    sideCount.textContent =
      `${total}/6`;
  }


  $("people").innerHTML = "";


  all.forEach((p) => {

    const chip =
      document.createElement("span");

    if (p === liveRoom.localParticipant) {

      chip.textContent =
        `${p.name || "Você"} (você)`;

    } else {

      chip.textContent =
        p.name || "Participante";

    }

    $("people").appendChild(chip);

  });
}


/* ===============================
   CRIAR / ENTRAR
================================ */

$("create").onclick = () => {
  enter(true);
};

$("join").onclick = () => {
  enter(false);
};


/* ===============================
   COMPARTILHAR TELA
================================ */

$("share").onclick = async () => {

  if (!liveRoom) {
    return setMessage(
      "Você ainda não está conectado à sala.",
      true
    );
  }


  /* PARAR TRANSMISSÃO */

  if (sharing) {

    try {

      for (const track of screenTracks) {

        try {

          await liveRoom.localParticipant
            .unpublishTrack(track);

        } catch (e) {
          console.warn(e);
        }


        try {
          track.stop();
        } catch (e) {
          console.warn(e);
        }
      }


      screenTracks = [];

      removeLocalPreview();

      sharing = false;

      $("share").textContent =
        "🖥 Compartilhar tela";

      setMessage(
        "Transmissão encerrada.",
        true
      );

      updateStage();

      return;

    } catch (err) {

      console.error(err);

      setMessage(
        "Não foi possível parar a transmissão.",
        true
      );

      return;
    }
  }


  /* COMEÇAR TRANSMISSÃO */

  try {

    setMessage(
      "Escolha a janela ou tela que deseja compartilhar.",
      true
    );


    /*
      IMPORTANTE:
      esta chamada abre diretamente
      o seletor nativo do Edge/Chrome.
    */

    const stream =
      await navigator.mediaDevices
        .getDisplayMedia({
          video: {
            frameRate: {
              ideal:
                $("fps")?.value === "60"
                  ? 60
                  : 30,
            },
          },

          audio: true,
        });


    const videoTrack =
      stream.getVideoTracks()[0];

    const audioTrack =
      stream.getAudioTracks()[0];


    if (!videoTrack) {

      stream
        .getTracks()
        .forEach((track) => track.stop());

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


    await liveRoom.localParticipant
      .publishTrack(
        localVideoTrack,
        {
          source:
            LK.Track.Source.ScreenShare,
          simulcast: true,
        }
      );


    screenTracks.push(
      localVideoTrack
    );


    /*
      ÁUDIO DA TELA/JANELA
    */

    if (audioTrack) {

      try {

        const localAudioTrack =
          new LK.LocalAudioTrack(
            audioTrack
          );


        await liveRoom.localParticipant
          .publishTrack(
            localAudioTrack,
            {
              source:
                LK.Track.Source.ScreenShareAudio,
            }
          );


        screenTracks.push(
          localAudioTrack
        );

      } catch (audioError) {

        console.warn(
          "Áudio da tela não pôde ser publicado:",
          audioError
        );
      }
    }


    /*
      MOSTRA A SUA PRÓPRIA
      TRANSMISSÃO NA TELA
    */

    attachVideo(
      localVideoTrack,
      liveRoom.localParticipant,
      true
    );


    sharing = true;


    $("share").textContent =
      "⏹ Parar transmissão";


    setMessage(
      "🔴 Você está transmitindo sua tela.",
      true
    );


    /*
      SE O USUÁRIO CLICAR EM
      "PARAR COMPARTILHAMENTO"
      NO PRÓPRIO EDGE
    */

    videoTrack.addEventListener(
      "ended",
      async () => {

        if (!sharing) return;


        for (const track of screenTracks) {

          try {

            await liveRoom.localParticipant
              .unpublishTrack(track);

          } catch (e) {
            console.warn(e);
          }

        }


        screenTracks = [];

        removeLocalPreview();

        sharing = false;

        $("share").textContent =
          "🖥 Compartilhar tela";

        setMessage(
          "Transmissão encerrada.",
          true
        );

        updateStage();
      }
    );


    updateStage();


  } catch (err) {

    console.error(
      "Erro ao compartilhar:",
      err
    );


    sharing = false;

    screenTracks = [];


    $("share").textContent =
      "🖥 Compartilhar tela";


    if (
      err.name === "NotAllowedError"
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
};


/* ===============================
   CONVITE
================================ */

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


/* ===============================
   SAIR
================================ */

$("leave").onclick = async () => {

  try {

    for (const track of screenTracks) {

      try {
        track.stop();
      } catch {}
    }


    if (liveRoom) {
      await liveRoom.disconnect();
    }

  } finally {

    location.href =
      location.pathname;
  }
};


/* ===============================
   FECHAR PÁGINA
================================ */

window.addEventListener(
  "beforeunload",
  () => {

    screenTracks.forEach(
      (track) => {

        try {
          track.stop();
        } catch {}

      }
    );

    liveRoom?.disconnect();
  }
);


/* ===============================
   NOME SALVO / CONVITE
================================ */

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
    'Convite carregado. Coloque seu nome e clique em "Entrar na sala".'
  );
}
