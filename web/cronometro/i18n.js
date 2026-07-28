/* i18n.js — multilingua del Cronometro web.
 *
 * Stesso motore del contagiri DS200 (dizionario in un file solo, niente fetch
 * a runtime: cosi' funziona offline come PWA con una sola voce in cache), ma
 * dizionario e chiave di memorizzazione suoi.
 *
 * Nel DOM:  data-i18n="chiave"        -> textContent
 *           data-i18n-html="chiave"   -> innerHTML (per <b>, <code>)
 *           data-i18n-title="chiave"  -> attributo title
 * Da JS:    I18N.t('chiave', {n: 3})
 */
(function (global) {
  "use strict";

  var LANGS = ["it", "en", "es", "fr", "de"];
  var BCP47 = { it: "it-IT", en: "en-US", es: "es-ES", fr: "fr-FR", de: "de-DE" };

  var DICT = {
    it: {
      "app.title": "Cronometro web",
      "app.sub": "Una gara, un'interfaccia, qualunque sia la pista.",
      "back": "← Slot Car Web Tools",

      "setup.title": "Prima della gara",
      "setup.system": "Sistema",
      "setup.mode": "Modalità",
      "setup.laps": "Giri",
      "setup.drivers": "Guidatori",
      "setup.driversHint": "I nomi si possono cambiare: clicca e scrivi. Restano su questo dispositivo.",
      "setup.addDriver": "+ Aggiungi guidatore",
      "setup.remove": "togli",
      "setup.slotsHint": "Aggiungi un posto per ogni corsia o auto in gara.",

      "sys.sim": "Simulazione",
      "sys.sim.desc": "Una pista finta, per provare l'applicazione senza hardware.",
      "sys.sim.speed": "Velocità",
      "sys.sim.seed": "Seme",
      "sys.sim.seedHint": "Con lo stesso seme esce sempre la stessa gara.",
      "sys.ds200": "DS200 / DS300",
      "sys.ds200.desc": "Cronometro DS Electronic via RS-232.",
      "sys.ds200.baud": "Baud",
      "sys.ds200.baudHint": "DS 300 = 57600 · DS 200 = 4800. Gli altri valori servono solo per provare.",
      "sys.noBus": "non disponibile in questo browser",

      "mode.pratica": "Pratica",
      "mode.pratica.desc": "Si gira e basta: nessun traguardo, il cronometro parte al primo passaggio.",
      "mode.gp": "GP a giri",
      "mode.gp.desc": "Vince chi arriva per primo al numero di giri stabilito.",

      "btn.connect": "Connetti",
      "btn.disconnect": "Disconnetti",
      "btn.start": "Via!",
      "btn.pause": "Pausa",
      "btn.resume": "Riprendi",
      "btn.stop": "Stop",
      "btn.reset": "Azzera",
      "btn.csv": "Export CSV",
      "btn.clear": "Pulisci",

      "ctrl.systemRuns": "La gara la comanda la centralina: partenza, pausa e fine si danno dai suoi tasti. L'app segue e registra. «Azzera» resta disponibile ed è solo locale.",
      "setup.atMax": "Sei al massimo: questa pista gestisce {n} posti.",
      "setup.tooMany": "Questa pista gestisce {n} posti, ma ne hai di più: {extra} non riceveranno passaggi. Non li tolgo io — decidi tu.",
      "prog.laps": "Programma letto dalla centralina: gara a {n} giri.",
      "prog.other": "La centralina è programmata a tempo (o in modalità F1): il cronometro per ora conta i giri, e la fine gara la annuncia lei.",
      "state.idle": "In attesa",
      "state.countdown": "Pronti…",
      "state.running": "In gara",
      "state.paused": "In pausa",
      "state.finished": "Finita",
      "state.aborted": "Interrotta",

      "hdr.pos": "Pos",
      "hdr.driver": "Guidatore",
      "hdr.laps": "Giri",
      "hdr.last": "Ultimo giro",
      "hdr.best": "Giro veloce",
      "hdr.gap": "Distacco",
      "hdr.fuel": "Benzina",

      "slot.lane": "Corsia",
      "slot.car": "Auto",
      "tbl.empty": "Nessun passaggio ancora. Collega un sistema e dai il via.",
      "tbl.reserve": "riserva",
      "tbl.pit": "box",
      "gap.laps": "+{n} giri",
      "gap.lap": "+1 giro",

      "info.state": "Stato",
      "info.clock": "Cronometro",
      "info.best": "Giro veloce",
      "info.leader": "In testa",
      "info.target": "Traguardo",
      "info.targetLaps": "{n} giri",

      "log.title": "Registro",
      "log.hint": "Quello che arriva dal sistema, così com'è.",
      "voice": "🔊 Voce",
      "voice_title": "Annuncio vocale di giri e risultati",
      "lang_title": "Lingua",

      "tts.on": "Annuncio vocale attivo",
      "tts.start": "Via!",
      "tts.paused": "Gara in pausa",
      "tts.resumed": "Si riparte",
      "tts.lap": "{who}, giro {n}, {time}",
      "tts.best": "giro veloce",
      "tts.lead": "{who} in testa",
      "tts.winner": "Vince {who}!",
      "tts.finished": "Gara finita",
      "time.min": "{n} minuti",
      "time.secAnd": "{s} secondi e {cc}",

      "foot.text": "Applicazione statica · funziona offline · nessun dato lascia il dispositivo.",
      "foot.disc": "Progetto indipendente, non ufficiale, senza legami con Slot.it / Galileo Engineering, DS Electronic o Ninco. Marchi dei rispettivi proprietari. Da usare solo su hardware di tua proprietà.",
      "install": "Installa questa pagina offline",
      "wip": "In costruzione. Funzionano la <b>simulazione</b> e il <b>DS200/DS300</b> — quest'ultimo però non è ancora stato provato su una centralina vera. <b>Ninco</b> e <b>oXigen</b> arrivano dopo."
    },

    en: {
      "app.title": "Web lap timer",
      "app.sub": "One race, one interface, whatever the track is.",
      "back": "← Slot Car Web Tools",

      "setup.title": "Before the race",
      "setup.system": "System",
      "setup.mode": "Mode",
      "setup.laps": "Laps",
      "setup.drivers": "Drivers",
      "setup.driversHint": "Names are editable: click and type. They stay on this device.",
      "setup.addDriver": "+ Add driver",
      "setup.remove": "remove",
      "setup.slotsHint": "Add one place per lane or car in the race.",

      "sys.sim": "Simulation",
      "sys.sim.desc": "A fake track, to try the app with no hardware.",
      "sys.sim.speed": "Speed",
      "sys.sim.seed": "Seed",
      "sys.sim.seedHint": "The same seed always produces the same race.",
      "sys.ds200": "DS200 / DS300",
      "sys.ds200.desc": "DS Electronic lap timer over RS-232.",
      "sys.ds200.baud": "Baud",
      "sys.ds200.baudHint": "DS 300 = 57600 · DS 200 = 4800. The other values are only for testing.",
      "sys.noBus": "not available in this browser",

      "mode.pratica": "Practice",
      "mode.pratica.desc": "Just driving: no finish line, the clock starts on the first crossing.",
      "mode.gp": "GP by laps",
      "mode.gp.desc": "First to the set number of laps wins.",

      "btn.connect": "Connect",
      "btn.disconnect": "Disconnect",
      "btn.start": "Go!",
      "btn.pause": "Pause",
      "btn.resume": "Resume",
      "btn.stop": "Stop",
      "btn.reset": "Reset",
      "btn.csv": "Export CSV",
      "btn.clear": "Clear",

      "ctrl.systemRuns": "The timer box runs the race: start, pause and finish come from its own buttons. The app follows and records. “Reset” stays available and is local only.",
      "setup.atMax": "At the limit: this track handles {n} places.",
      "setup.tooMany": "This track handles {n} places and you have more: {extra} will get no crossings. I am not removing them — that's your call.",
      "prog.laps": "Race programme read from the timer box: {n} laps.",
      "prog.other": "The timer box is programmed by time (or in F1 mode): for now the app counts laps, and the box announces the finish.",
      "state.idle": "Waiting",
      "state.countdown": "Ready…",
      "state.running": "Racing",
      "state.paused": "Paused",
      "state.finished": "Finished",
      "state.aborted": "Aborted",

      "hdr.pos": "Pos",
      "hdr.driver": "Driver",
      "hdr.laps": "Laps",
      "hdr.last": "Last lap",
      "hdr.best": "Fast lap",
      "hdr.gap": "Gap",
      "hdr.fuel": "Fuel",

      "slot.lane": "Lane",
      "slot.car": "Car",
      "tbl.empty": "No crossing yet. Connect a system and start.",
      "tbl.reserve": "reserve",
      "tbl.pit": "pit",
      "gap.laps": "+{n} laps",
      "gap.lap": "+1 lap",

      "info.state": "State",
      "info.clock": "Clock",
      "info.best": "Fast lap",
      "info.leader": "Leader",
      "info.target": "Target",
      "info.targetLaps": "{n} laps",

      "log.title": "Log",
      "log.hint": "What the system sends, as it comes.",
      "voice": "🔊 Voice",
      "voice_title": "Spoken laps and results",
      "lang_title": "Language",

      "tts.on": "Voice announcements on",
      "tts.start": "Go!",
      "tts.paused": "Race paused",
      "tts.resumed": "Racing again",
      "tts.lap": "{who}, lap {n}, {time}",
      "tts.best": "fast lap",
      "tts.lead": "{who} leads",
      "tts.winner": "{who} wins!",
      "tts.finished": "Race over",
      "time.min": "{n} minutes",
      "time.secAnd": "{s} seconds and {cc}",

      "foot.text": "Static app · works offline · no data leaves your device.",
      "foot.disc": "Independent, unofficial project, not affiliated with Slot.it / Galileo Engineering, DS Electronic or Ninco. Trademarks belong to their owners. Use only on hardware you own.",
      "install": "Install this page offline",
      "wip": "Work in progress. The <b>simulation</b> and the <b>DS200/DS300</b> work — the latter has not been tried on a real timer yet, though. <b>Ninco</b> and <b>oXigen</b> come next."
    },

    es: {
      "app.title": "Cronómetro web",
      "app.sub": "Una carrera, una interfaz, sea cual sea la pista.",
      "back": "← Slot Car Web Tools",

      "setup.title": "Antes de la carrera",
      "setup.system": "Sistema",
      "setup.mode": "Modo",
      "setup.laps": "Vueltas",
      "setup.drivers": "Pilotos",
      "setup.driversHint": "Los nombres se pueden cambiar: haz clic y escribe. Se quedan en este dispositivo.",
      "setup.addDriver": "+ Añadir piloto",
      "setup.remove": "quitar",
      "setup.slotsHint": "Añade un puesto por cada carril o coche en carrera.",

      "sys.sim": "Simulación",
      "sys.sim.desc": "Una pista ficticia, para probar la aplicación sin hardware.",
      "sys.sim.speed": "Velocidad",
      "sys.sim.seed": "Semilla",
      "sys.sim.seedHint": "Con la misma semilla sale siempre la misma carrera.",
      "sys.ds200": "DS200 / DS300",
      "sys.ds200.desc": "Cronómetro DS Electronic por RS-232.",
      "sys.ds200.baud": "Baudios",
      "sys.ds200.baudHint": "DS 300 = 57600 · DS 200 = 4800. Los demás valores son solo para probar.",
      "sys.noBus": "no disponible en este navegador",

      "mode.pratica": "Práctica",
      "mode.pratica.desc": "Solo rodar: sin meta, el cronómetro arranca en el primer paso.",
      "mode.gp": "GP a vueltas",
      "mode.gp.desc": "Gana quien llegue primero al número de vueltas fijado.",

      "btn.connect": "Conectar",
      "btn.disconnect": "Desconectar",
      "btn.start": "¡Ya!",
      "btn.pause": "Pausa",
      "btn.resume": "Reanudar",
      "btn.stop": "Stop",
      "btn.reset": "Reiniciar",
      "btn.csv": "Exportar CSV",
      "btn.clear": "Limpiar",

      "ctrl.systemRuns": "La carrera la manda el cronómetro: salida, pausa y final se dan con sus teclas. La app sigue y registra. «Reiniciar» sigue disponible y es solo local.",
      "setup.atMax": "Estás en el máximo: esta pista gestiona {n} puestos.",
      "setup.tooMany": "Esta pista gestiona {n} puestos y tienes más: {extra} no recibirán pasos. No los quito yo — decides tú.",
      "prog.laps": "Programa leído del cronómetro: carrera a {n} vueltas.",
      "prog.other": "El cronómetro está programado por tiempo (o en modo F1): por ahora la app cuenta vueltas, y el final lo anuncia él.",
      "state.idle": "Esperando",
      "state.countdown": "Preparados…",
      "state.running": "En carrera",
      "state.paused": "En pausa",
      "state.finished": "Terminada",
      "state.aborted": "Anulada",

      "hdr.pos": "Pos",
      "hdr.driver": "Piloto",
      "hdr.laps": "Vueltas",
      "hdr.last": "Última vuelta",
      "hdr.best": "Vuelta rápida",
      "hdr.gap": "Diferencia",
      "hdr.fuel": "Combustible",

      "slot.lane": "Carril",
      "slot.car": "Coche",
      "tbl.empty": "Todavía no ha pasado nadie. Conecta un sistema y da la salida.",
      "tbl.reserve": "reserva",
      "tbl.pit": "boxes",
      "gap.laps": "+{n} vueltas",
      "gap.lap": "+1 vuelta",

      "info.state": "Estado",
      "info.clock": "Cronómetro",
      "info.best": "Vuelta rápida",
      "info.leader": "Líder",
      "info.target": "Meta",
      "info.targetLaps": "{n} vueltas",

      "log.title": "Registro",
      "log.hint": "Lo que manda el sistema, tal cual.",
      "voice": "🔊 Voz",
      "voice_title": "Anuncio por voz de vueltas y resultados",
      "lang_title": "Idioma",

      "tts.on": "Anuncios de voz activados",
      "tts.start": "¡Ya!",
      "tts.paused": "Carrera en pausa",
      "tts.resumed": "Se reanuda",
      "tts.lap": "{who}, vuelta {n}, {time}",
      "tts.best": "vuelta rápida",
      "tts.lead": "{who} en cabeza",
      "tts.winner": "¡Gana {who}!",
      "tts.finished": "Carrera terminada",
      "time.min": "{n} minutos",
      "time.secAnd": "{s} segundos y {cc}",

      "foot.text": "Aplicación estática · funciona sin conexión · ningún dato sale del dispositivo.",
      "foot.disc": "Proyecto independiente, no oficial, sin vínculo con Slot.it / Galileo Engineering, DS Electronic o Ninco. Las marcas son de sus propietarios. Úsalo solo en hardware de tu propiedad.",
      "install": "Instalar esta página sin conexión",
      "wip": "En construcción. Funcionan la <b>simulación</b> y el <b>DS200/DS300</b>, aunque este último todavía no se ha probado con un cronómetro real. <b>Ninco</b> y <b>oXigen</b> vienen después."
    },

    fr: {
      "app.title": "Chronomètre web",
      "app.sub": "Une course, une interface, quelle que soit la piste.",
      "back": "← Slot Car Web Tools",

      "setup.title": "Avant la course",
      "setup.system": "Système",
      "setup.mode": "Mode",
      "setup.laps": "Tours",
      "setup.drivers": "Pilotes",
      "setup.driversHint": "Les noms sont modifiables : clique et écris. Ils restent sur cet appareil.",
      "setup.addDriver": "+ Ajouter un pilote",
      "setup.remove": "retirer",
      "setup.slotsHint": "Ajoute une place par couloir ou par voiture en course.",

      "sys.sim": "Simulation",
      "sys.sim.desc": "Une piste factice, pour essayer l'application sans matériel.",
      "sys.sim.speed": "Vitesse",
      "sys.sim.seed": "Graine",
      "sys.sim.seedHint": "Avec la même graine, la course est toujours identique.",
      "sys.ds200": "DS200 / DS300",
      "sys.ds200.desc": "Chronomètre DS Electronic via RS-232.",
      "sys.ds200.baud": "Baud",
      "sys.ds200.baudHint": "DS 300 = 57600 · DS 200 = 4800. Les autres valeurs ne servent qu'aux essais.",
      "sys.noBus": "indisponible dans ce navigateur",

      "mode.pratica": "Essais",
      "mode.pratica.desc": "On roule, c'est tout : pas d'arrivée, le chrono part au premier passage.",
      "mode.gp": "GP en tours",
      "mode.gp.desc": "Le premier au nombre de tours fixé gagne.",

      "btn.connect": "Connecter",
      "btn.disconnect": "Déconnecter",
      "btn.start": "Départ !",
      "btn.pause": "Pause",
      "btn.resume": "Reprendre",
      "btn.stop": "Stop",
      "btn.reset": "Réinitialiser",
      "btn.csv": "Exporter CSV",
      "btn.clear": "Effacer",

      "ctrl.systemRuns": "C'est le chrono qui mène la course : départ, pause et arrivée se donnent avec ses touches. L'application suit et enregistre. « Réinitialiser » reste disponible et n'agit qu'en local.",
      "setup.atMax": "Au maximum : cette piste gère {n} places.",
      "setup.tooMany": "Cette piste gère {n} places et tu en as davantage : {extra} ne recevront aucun passage. Je ne les enlève pas — c'est à toi de décider.",
      "prog.laps": "Programme lu sur le chrono : course en {n} tours.",
      "prog.other": "Le chrono est programmé au temps (ou en mode F1) : pour l'instant l'application compte les tours, et c'est lui qui annonce l'arrivée.",
      "state.idle": "En attente",
      "state.countdown": "Prêts…",
      "state.running": "En course",
      "state.paused": "En pause",
      "state.finished": "Terminée",
      "state.aborted": "Annulée",

      "hdr.pos": "Pos",
      "hdr.driver": "Pilote",
      "hdr.laps": "Tours",
      "hdr.last": "Dernier tour",
      "hdr.best": "Meilleur tour",
      "hdr.gap": "Écart",
      "hdr.fuel": "Carburant",

      "slot.lane": "Couloir",
      "slot.car": "Voiture",
      "tbl.empty": "Aucun passage pour l'instant. Connecte un système et lance la course.",
      "tbl.reserve": "réserve",
      "tbl.pit": "stand",
      "gap.laps": "+{n} tours",
      "gap.lap": "+1 tour",

      "info.state": "État",
      "info.clock": "Chronomètre",
      "info.best": "Meilleur tour",
      "info.leader": "En tête",
      "info.target": "Objectif",
      "info.targetLaps": "{n} tours",

      "log.title": "Journal",
      "log.hint": "Ce que le système envoie, tel quel.",
      "voice": "🔊 Voix",
      "voice_title": "Annonce vocale des tours et des résultats",
      "lang_title": "Langue",

      "tts.on": "Annonces vocales activées",
      "tts.start": "Départ !",
      "tts.paused": "Course en pause",
      "tts.resumed": "On repart",
      "tts.lap": "{who}, tour {n}, {time}",
      "tts.best": "meilleur tour",
      "tts.lead": "{who} en tête",
      "tts.winner": "{who} gagne !",
      "tts.finished": "Course terminée",
      "time.min": "{n} minutes",
      "time.secAnd": "{s} secondes et {cc}",

      "foot.text": "Application statique · fonctionne hors ligne · aucune donnée ne quitte l'appareil.",
      "foot.disc": "Projet indépendant, non officiel, sans lien avec Slot.it / Galileo Engineering, DS Electronic ou Ninco. Marques déposées par leurs propriétaires. À utiliser uniquement sur du matériel qui t'appartient.",
      "install": "Installer cette page hors ligne",
      "wip": "En construction. La <b>simulation</b> et le <b>DS200/DS300</b> fonctionnent — ce dernier n'a toutefois pas encore été essayé sur un vrai chrono. <b>Ninco</b> et <b>oXigen</b> arrivent ensuite."
    },

    de: {
      "app.title": "Web-Zeitmessung",
      "app.sub": "Ein Rennen, eine Oberfläche, egal welche Bahn.",
      "back": "← Slot Car Web Tools",

      "setup.title": "Vor dem Rennen",
      "setup.system": "System",
      "setup.mode": "Modus",
      "setup.laps": "Runden",
      "setup.drivers": "Fahrer",
      "setup.driversHint": "Namen sind änderbar: anklicken und tippen. Sie bleiben auf diesem Gerät.",
      "setup.addDriver": "+ Fahrer hinzufügen",
      "setup.remove": "entfernen",
      "setup.slotsHint": "Für jede Spur bzw. jedes Auto im Rennen einen Platz anlegen.",

      "sys.sim": "Simulation",
      "sys.sim.desc": "Eine Bahn zum Ausprobieren, ganz ohne Hardware.",
      "sys.sim.speed": "Tempo",
      "sys.sim.seed": "Startwert",
      "sys.sim.seedHint": "Gleicher Startwert, gleiches Rennen.",
      "sys.ds200": "DS200 / DS300",
      "sys.ds200.desc": "DS-Electronic-Zeitmessung über RS-232.",
      "sys.ds200.baud": "Baud",
      "sys.ds200.baudHint": "DS 300 = 57600 · DS 200 = 4800. Die anderen Werte sind nur zum Testen.",
      "sys.noBus": "in diesem Browser nicht verfügbar",

      "mode.pratica": "Training",
      "mode.pratica.desc": "Einfach fahren: kein Ziel, die Uhr startet beim ersten Durchfahren.",
      "mode.gp": "GP nach Runden",
      "mode.gp.desc": "Wer die festgelegte Rundenzahl zuerst erreicht, gewinnt.",

      "btn.connect": "Verbinden",
      "btn.disconnect": "Trennen",
      "btn.start": "Los!",
      "btn.pause": "Pause",
      "btn.resume": "Weiter",
      "btn.stop": "Stop",
      "btn.reset": "Zurücksetzen",
      "btn.csv": "CSV-Export",
      "btn.clear": "Leeren",

      "ctrl.systemRuns": "Das Rennen führt die Zeitmessanlage: Start, Pause und Ziel kommen von ihren Tasten. Die App folgt und protokolliert. „Zurücksetzen“ bleibt verfügbar und wirkt nur lokal.",
      "setup.atMax": "Am Limit: diese Bahn verwaltet {n} Plätze.",
      "setup.tooMany": "Diese Bahn verwaltet {n} Plätze, du hast mehr: {extra} bekommen keine Durchfahrten. Ich entferne sie nicht — das entscheidest du.",
      "prog.laps": "Rennprogramm von der Anlage gelesen: {n} Runden.",
      "prog.other": "Die Anlage ist auf Zeit (oder im F1-Modus) programmiert: die App zählt vorerst Runden, das Ende meldet die Anlage.",
      "state.idle": "Wartet",
      "state.countdown": "Achtung…",
      "state.running": "Im Rennen",
      "state.paused": "Pausiert",
      "state.finished": "Beendet",
      "state.aborted": "Abgebrochen",

      "hdr.pos": "Pos",
      "hdr.driver": "Fahrer",
      "hdr.laps": "Runden",
      "hdr.last": "Letzte Runde",
      "hdr.best": "Schnellste Runde",
      "hdr.gap": "Rückstand",
      "hdr.fuel": "Sprit",

      "slot.lane": "Spur",
      "slot.car": "Auto",
      "tbl.empty": "Noch keine Durchfahrt. System verbinden und starten.",
      "tbl.reserve": "Reserve",
      "tbl.pit": "Box",
      "gap.laps": "+{n} Runden",
      "gap.lap": "+1 Runde",

      "info.state": "Status",
      "info.clock": "Uhr",
      "info.best": "Schnellste Runde",
      "info.leader": "Führend",
      "info.target": "Ziel",
      "info.targetLaps": "{n} Runden",

      "log.title": "Protokoll",
      "log.hint": "Was das System sendet, unverändert.",
      "voice": "🔊 Sprache",
      "voice_title": "Sprachansage von Runden und Ergebnissen",
      "lang_title": "Sprache",

      "tts.on": "Sprachansagen aktiv",
      "tts.start": "Los!",
      "tts.paused": "Rennen pausiert",
      "tts.resumed": "Weiter geht's",
      "tts.lap": "{who}, Runde {n}, {time}",
      "tts.best": "schnellste Runde",
      "tts.lead": "{who} führt",
      "tts.winner": "{who} gewinnt!",
      "tts.finished": "Rennen beendet",
      "time.min": "{n} Minuten",
      "time.secAnd": "{s} Sekunden und {cc}",

      "foot.text": "Statische App · funktioniert offline · keine Daten verlassen das Gerät.",
      "foot.disc": "Unabhängiges, inoffizielles Projekt, ohne Verbindung zu Slot.it / Galileo Engineering, DS Electronic oder Ninco. Marken gehören ihren Inhabern. Nur auf eigener Hardware verwenden.",
      "install": "Diese Seite offline installieren",
      "wip": "Im Aufbau. <b>Simulation</b> und <b>DS200/DS300</b> laufen — letzteres wurde aber noch nicht an einer echten Anlage erprobt. <b>Ninco</b> und <b>oXigen</b> folgen."
    }
  };

  var STORAGE_KEY = "cronometro.lang";

  function detect() {
    var saved = null;
    try { saved = localStorage.getItem(STORAGE_KEY); } catch (e) { saved = null; }
    if (saved && LANGS.indexOf(saved) >= 0) return saved;
    var nav = (navigator.languages && navigator.languages[0]) || navigator.language || "en";
    var two = nav.slice(0, 2).toLowerCase();
    return LANGS.indexOf(two) >= 0 ? two : "en";
  }

  var I18N = {
    current: "en",
    langs: LANGS,
    init: function () { this.current = detect(); this.applyDom(); return this.current; },
    setLang: function (l) {
      if (LANGS.indexOf(l) < 0) return;
      this.current = l;
      try { localStorage.setItem(STORAGE_KEY, l); } catch (e) {}
    },
    bcp47: function () { return BCP47[this.current] || "en-US"; },
    t: function (key, params) {
      var table = DICT[this.current] || DICT.en;
      var s = (key in table) ? table[key] : (DICT.en[key] != null ? DICT.en[key] : key);
      if (params) s = s.replace(/\{(\w+)\}/g, function (m, k) {
        return params[k] != null ? params[k] : m;
      });
      return s;
    },
    applyDom: function (root) {
      var self = this;
      var scope = root || document;
      scope.querySelectorAll("[data-i18n]").forEach(function (el) {
        el.textContent = self.t(el.getAttribute("data-i18n"));
      });
      scope.querySelectorAll("[data-i18n-html]").forEach(function (el) {
        el.innerHTML = self.t(el.getAttribute("data-i18n-html"));
      });
      scope.querySelectorAll("[data-i18n-title]").forEach(function (el) {
        el.title = self.t(el.getAttribute("data-i18n-title"));
      });
      document.documentElement.lang = this.current;
    }
  };

  global.I18N = I18N;
})(typeof window !== "undefined" ? window : this);
