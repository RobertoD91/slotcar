#pragma once
#include <Arduino.h>

// Full live web UI served by the ESP32 at "/". Fed by /ws (WebSocket) with the
// same JSON the firmware publishes. Mirrors the PWA: 5-language i18n, browser
// text-to-speech, a free-running race clock, a big leaderboard, winner, events
// and a raw frame log (webserial-style). Self-contained (lives in flash).
static const char INDEX_HTML[] PROGMEM = R"HTML(<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>DS200</title>
<style>
:root{--bg:#0b0f17;--panel:#131a26;--panel2:#1a2332;--line:#243044;--text:#e6edf6;--muted:#8aa0bd;--accent:#ff3b3b;--accent2:#2ea3ff;--ok:#36d399;--bad:#ff6b6b;--best:#ffd54a;--mono:ui-monospace,Menlo,Consolas,monospace}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.45 system-ui,Segoe UI,Roboto,sans-serif;padding-bottom:30px}
header{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;padding:12px 18px;border-bottom:1px solid var(--line);background:#0f1622;position:sticky;top:0;z-index:5}
h1{font-size:17px;margin:0}small{color:var(--muted)}
.conn{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
select{background:var(--panel2);color:var(--text);border:1px solid var(--line);border-radius:8px;padding:7px 10px}
.chk{color:var(--muted);font-size:14px;display:flex;align-items:center;gap:6px}
.status{font-size:13px;padding:5px 10px;border-radius:999px;border:1px solid var(--line);color:var(--muted)}
.status.on{color:var(--ok);border-color:var(--ok)}
.clockwrap{padding:16px 18px 0}
.bigclock{width:100%;text-align:center;font-weight:800;font-size:clamp(48px,13vw,150px);line-height:1.04;letter-spacing:2px;color:var(--accent);font-variant-numeric:tabular-nums;background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:12px 10px;text-shadow:0 0 28px rgba(255,59,59,.28);overflow:hidden;white-space:nowrap}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;padding:14px 18px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px}
.k{color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.5px}.v{font-size:22px;font-weight:600}.v.winner{color:var(--best)}.mono{font-family:var(--mono)}
main{padding:0 18px 24px;display:grid;grid-template-columns:2fr 1fr;gap:16px}
@media(max-width:820px){main{grid-template-columns:1fr}}
.wide{grid-column:1/-1}
table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:14px 12px;border-bottom:1px solid var(--line)}
th{color:var(--muted);font-size:13px;text-transform:uppercase}td{font-size:22px}td.pos{font-weight:800;color:var(--accent2);font-size:26px}td.mono{font-size:24px}td.best{color:var(--best)}
tr:first-child td.pos{color:var(--best)}tr.winrow td{background:rgba(255,213,74,.08)}
h2{font-size:14px;margin:0 0 8px}.events{list-style:none;margin:0;padding:0;max-height:360px;overflow:auto}
.events li{padding:7px 2px;border-bottom:1px solid var(--line);font-size:14px}.events .t{color:var(--muted);font-size:12px;margin-right:6px}
.log{background:#0a0e15;border:1px solid var(--line);border-radius:10px;padding:12px;max-height:300px;overflow:auto;font-family:var(--mono);font-size:12.5px;white-space:pre-wrap;word-break:break-all}
.log .bad{color:var(--bad)}.log .ok{color:#b9c7da}
.foot{color:var(--muted);font-size:12px;padding:10px 18px;border-top:1px solid var(--line)}.foot a{color:var(--accent2)}
</style></head>
<body>
<header>
  <div><h1>🏁 DS200 — ESP32</h1><small id="sub"></small></div>
  <div class="conn">
    <label class="chk" title="lang">🌐
      <select id="lang">
        <option value="it">Italiano</option><option value="en">English</option>
        <option value="es">Español</option><option value="fr">Français</option><option value="de">Deutsch</option>
      </select>
    </label>
    <label class="chk" id="ttsl"><input type="checkbox" id="tts"> <span id="ttslbl"></span></label>
    <span id="st" class="status"></span>
  </div>
</header>
<section class="clockwrap"><div id="clock" class="bigclock mono">00:00:00.00</div></section>
<section class="cards">
  <div class="card"><div class="k" id="k_dev"></div><div id="dev" class="v">—</div></div>
  <div class="card"><div class="k" id="k_race"></div><div id="race" class="v">—</div></div>
  <div class="card"><div class="k" id="k_ntp"></div><div id="ntp" class="v mono">—</div></div>
  <div class="card"><div class="k" id="k_cnt"></div><div id="cnt" class="v mono">0 / 0</div></div>
</section>
<main>
  <div class="card">
    <h2 id="k_lb"></h2>
    <table><thead><tr>
      <th id="h_pos"></th><th id="h_lane"></th><th id="h_laps"></th><th id="h_last"></th><th id="h_fast"></th>
    </tr></thead><tbody id="lanes"></tbody></table>
  </div>
  <div class="card"><h2 id="k_ev"></h2><ul id="events" class="events"></ul></div>
  <div class="card wide">
    <h2 id="k_log"></h2>
    <pre id="log" class="log"></pre>
  </div>
</main>
<div class="foot"><span id="f_text"></span> <span id="ver"></span> · <a href="/config">⚙︎ <span id="f_set"></span></a></div>
<script>
var DICT={
 it:{sub:"Cronometro slot car — DS200 / DS300",voice:"🔊 Voce",dev:"Dispositivo",race:"Stato gara",ntp:"Ora (NTP)",cnt:"Frame ok / tot",lb:"Classifica per corsia",ev:"Eventi",log:"Log frame (raw)",pos:"Pos",lane:"Corsia",laps:"Giri",last:"Ultimo giro",fast:"Giro veloce",lapw:"giro",foot:"Dati in tempo reale via WebSocket · pubblicati su MQTT con timestamp NTP.",set:"Impostazioni",connecting:"connessione…",connected:"connesso",reconnecting:"riconnessione…",fastlap:"Giro veloce",firstpos:"Prima posizione",ton:"Annuncio vocale attivo",start:"Partenza!",winner:"Vince {lane} {n}!",th:"ore",tm:"minuti",tsec:"{s} secondi e {cc}",fn:{start_race_phase_1:"Start gara — fase 1",start_race_phase_2:"Start gara — fase 2",start_race_phase_3:"Start gara — fase 3",end_race:"Fine gara",start_pause:"Inizio pausa",end_pause:"Fine pausa",abort_race:"Gara annullata"}},
 en:{sub:"Slot car lap timer — DS200 / DS300",voice:"🔊 Voice",dev:"Device",race:"Race state",ntp:"Time (NTP)",cnt:"Frames ok / total",lb:"Standings by lane",ev:"Events",log:"Frame log (raw)",pos:"Pos",lane:"Lane",laps:"Laps",last:"Last lap",fast:"Fast lap",lapw:"lap",foot:"Live over WebSocket · published to MQTT with NTP timestamp.",set:"Settings",connecting:"connecting…",connected:"connected",reconnecting:"reconnecting…",fastlap:"Fast lap",firstpos:"First position",ton:"Voice announcements on",start:"Start!",winner:"{lane} {n} wins!",th:"hours",tm:"minutes",tsec:"{s} seconds and {cc}",fn:{start_race_phase_1:"Race start — phase 1",start_race_phase_2:"Race start — phase 2",start_race_phase_3:"Race start — phase 3",end_race:"Race end",start_pause:"Pause start",end_pause:"Pause end",abort_race:"Race aborted"}},
 es:{sub:"Cronómetro slot car — DS200 / DS300",voice:"🔊 Voz",dev:"Dispositivo",race:"Estado carrera",ntp:"Hora (NTP)",cnt:"Tramas ok / total",lb:"Clasificación por carril",ev:"Eventos",log:"Registro de tramas (raw)",pos:"Pos",lane:"Carril",laps:"Vueltas",last:"Última vuelta",fast:"Vuelta rápida",lapw:"vuelta",foot:"En vivo por WebSocket · publicado en MQTT con marca NTP.",set:"Ajustes",connecting:"conectando…",connected:"conectado",reconnecting:"reconectando…",fastlap:"Vuelta rápida",firstpos:"Primera posición",ton:"Anuncios de voz activados",start:"¡Salida!",winner:"¡Gana {lane} {n}!",th:"horas",tm:"minutos",tsec:"{s} segundos y {cc}",fn:{start_race_phase_1:"Inicio carrera — fase 1",start_race_phase_2:"Inicio carrera — fase 2",start_race_phase_3:"Inicio carrera — fase 3",end_race:"Fin de carrera",start_pause:"Inicio de pausa",end_pause:"Fin de pausa",abort_race:"Carrera anulada"}},
 fr:{sub:"Chronomètre slot car — DS200 / DS300",voice:"🔊 Voix",dev:"Appareil",race:"État course",ntp:"Heure (NTP)",cnt:"Trames ok / total",lb:"Classement par couloir",ev:"Événements",log:"Journal des trames (raw)",pos:"Pos",lane:"Couloir",laps:"Tours",last:"Dernier tour",fast:"Meilleur tour",lapw:"tour",foot:"En direct via WebSocket · publié sur MQTT avec horodatage NTP.",set:"Réglages",connecting:"connexion…",connected:"connecté",reconnecting:"reconnexion…",fastlap:"Meilleur tour",firstpos:"Première position",ton:"Annonces vocales activées",start:"Départ !",winner:"Le {lane} {n} gagne !",th:"heures",tm:"minutes",tsec:"{s} secondes et {cc}",fn:{start_race_phase_1:"Départ course — phase 1",start_race_phase_2:"Départ course — phase 2",start_race_phase_3:"Départ course — phase 3",end_race:"Fin de course",start_pause:"Début de pause",end_pause:"Fin de pause",abort_race:"Course annulée"}},
 de:{sub:"Slotcar-Rundenzeit — DS200 / DS300",voice:"🔊 Sprache",dev:"Gerät",race:"Rennstatus",ntp:"Zeit (NTP)",cnt:"Frames ok / gesamt",lb:"Wertung nach Spur",ev:"Ereignisse",log:"Frame-Log (raw)",pos:"Pos",lane:"Spur",laps:"Runden",last:"Letzte Runde",fast:"Schnellste Runde",lapw:"Runde",foot:"Live über WebSocket · auf MQTT mit NTP-Zeitstempel.",set:"Einstellungen",connecting:"verbinde…",connected:"verbunden",reconnecting:"neu verbinden…",fastlap:"Schnellste Runde",firstpos:"Erster Platz",ton:"Sprachansagen aktiv",start:"Start!",winner:"{lane} {n} gewinnt!",th:"Stunden",tm:"Minuten",tsec:"{s} Sekunden und {cc}",fn:{start_race_phase_1:"Rennstart — Phase 1",start_race_phase_2:"Rennstart — Phase 2",start_race_phase_3:"Rennstart — Phase 3",end_race:"Rennende",start_pause:"Pause Start",end_pause:"Pause Ende",abort_race:"Rennen abgebrochen"}}
};
var BCP={it:"it-IT",en:"en-US",es:"es-ES",fr:"fr-FR",de:"de-DE"};
var $=function(id){return document.getElementById(id)};
var lang=(function(){try{var s=localStorage.getItem("ds200.lang");if(s&&DICT[s])return s}catch(e){}var n=(navigator.language||"en").slice(0,2);return DICT[n]?n:"en"})();
function t(k,p){var d=DICT[lang]||DICT.en;var s=(k in d)?d[k]:(DICT.en[k]!=null?DICT.en[k]:k);if(p)s=s.replace(/\{(\w+)\}/g,function(m,x){return p[x]!=null?p[x]:m});return s}
function fnLabel(fn){var d=(DICT[lang]||DICT.en).fn;return (d&&d[fn])||(DICT.en.fn[fn])||fn}
// ---- TTS ----
var ttsOK=("speechSynthesis" in window),voice=null;
function pickVoice(){if(!ttsOK)return;var v=speechSynthesis.getVoices();voice=v.find(function(x){return new RegExp("^"+lang+"[-_]","i").test(x.lang)})||v.find(function(x){return (x.lang||"").toLowerCase().indexOf(lang)===0})||null}
if(ttsOK){pickVoice();speechSynthesis.onvoiceschanged=pickVoice}
function speak(s){if(!ttsOK||!$("tts").checked)return;var u=new SpeechSynthesisUtterance(s);u.lang=BCP[lang]||"en-US";if(voice)u.voice=voice;u.rate=1.05;speechSynthesis.speak(u)}
function spokenTime(f){if(!f.time_text)return"";var a=f.time_text.split(":"),h=+a[0],m=+a[1],b=(a[2]||"0").split("."),s=+b[0],cc=(b[1]||"0000").slice(0,2);var p=[];if(h>0)p.push(h+" "+t("th"));if(m>0)p.push(m+" "+t("tm"));p.push(t("tsec",{s:s,cc:cc}));return p.join(" ")}
// ---- state ----
var lanes={},okC=0,totC=0,raceFn=null,winner=null,announced={},lastSpoken=null;
var raceActive=false,lapsSinceStart=0,lastFinalSec=0,winnerTimer=null;
// ---- race clock ----
var RC=(function(){var run=false,t0=0,acc=0,ps=0,fz=null;function live(){var e=performance.now()-t0-acc;if(ps)e-=(performance.now()-ps);return e}return{
 start:function(){run=true;t0=performance.now();acc=0;ps=0;fz=null},
 syncTo:function(ms){run=true;t0=performance.now()-ms;acc=0;ps=0;fz=null},
 pause:function(){if(run&&!ps)ps=performance.now()},
 resume:function(){if(run&&ps){acc+=performance.now()-ps;ps=0}},
 stop:function(){if(run){fz=live();run=false;ps=0}},
 freezeAt:function(ms){run=false;ps=0;fz=ms},
 reset:function(){run=false;t0=0;acc=0;ps=0;fz=null},
 ms:function(){return run?live():(fz!=null?fz:0)}}})();
function fmtEl(ms){if(!(ms>0))ms=0;var cs=Math.floor(ms/10),cc=cs%100,tt=Math.floor(cs/100),s=tt%60,m=Math.floor(tt/60)%60,h=Math.floor(tt/3600);function p(n){return("0"+n).slice(-2)}return p(h)+":"+p(m)+":"+p(s)+"."+p(cc)}
setInterval(function(){$("clock").textContent=fmtEl(RC.ms())},50);
// ---- rendering ----
function applyStatic(){
 document.documentElement.lang=lang;$("sub").textContent=t("sub");$("ttslbl").textContent=t("voice");
 $("k_dev").textContent=t("dev");$("k_race").textContent=t("race");$("k_ntp").textContent=t("ntp");$("k_cnt").textContent=t("cnt");
 $("k_lb").textContent=t("lb");$("k_ev").textContent=t("ev");$("k_log").textContent=t("log");
 $("h_pos").textContent=t("pos");$("h_lane").textContent=t("lane");$("h_laps").textContent=t("laps");$("h_last").textContent=t("last");$("h_fast").textContent=t("fast");
 $("f_text").textContent=t("foot");$("f_set").textContent=t("set");
 if(raceFn&&!winner)$("race").textContent=fnLabel(raceFn);
 render();
}
function fmt(ts){if(!ts)return"";var d=new Date(ts*1000);return d.toLocaleTimeString(BCP[lang],{hour12:false})}
function sorted(){var r=Object.keys(lanes).map(function(l){var o=lanes[l];return{lane:+l,laps:o.laps,last:o.last,best:o.best,bestSec:o.bestSec}});r.sort(function(a,b){return (b.laps-a.laps)||((a.bestSec==null?1e9:a.bestSec)-(b.bestSec==null?1e9:b.bestSec))});return r}
function render(){
 var r=sorted();$("lanes").innerHTML=r.map(function(x,i){var w=winner&&x.lane===winner.lane;
  return "<tr"+(w?" class=winrow":"")+"><td class=pos>"+(w?"🏆 ":"")+(i+1)+"</td><td>"+t("lane")+" "+x.lane+"</td><td class=mono>"+x.laps+"</td><td class=mono>"+(x.last||"—")+"</td><td class='mono best'>"+(x.best||"—")+"</td></tr>"}).join("")
}
function ev(ts,txt){var li=document.createElement("li");li.innerHTML="<span class='t mono'>"+fmt(ts)+"</span> "+txt;$("events").prepend(li);while($("events").children.length>60)$("events").lastChild.remove()}
function logLine(f){var bad=f.warnings&&f.warnings.length;var sp=document.createElement("span");sp.className=bad?"bad":"ok";
 sp.textContent="["+fmt(f.ts)+"] "+(f.device||"")+" "+(f.data_type||"")+(f.lane?" lane"+f.lane:"")+" laps="+(f.laps==null?"?":f.laps)+" t="+(f.time_text||(f.no_time?"—":"?"))+(bad?"  ⚠ "+f.warnings.join(";"):"")+"\n  "+(f.raw||"")+"\n";
 $("log").appendChild(sp);while($("log").children.length>400)$("log").firstChild.remove();$("log").scrollTop=$("log").scrollHeight}
// ---- race lifecycle ----
function resetRace(){lanes={};announced={};winner=null;lastFinalSec=0;if(winnerTimer){clearTimeout(winnerTimer);winnerTimer=null}render()}
function onFunction(f){var fn=f.function;
 if(fn&&fn.indexOf("start_race_phase")===0){if(!raceActive){raceActive=true;lapsSinceStart=0;resetRace();RC.start()}else if(lapsSinceStart===0){RC.start()}}
 else if(fn==="start_pause"){RC.pause()}
 else if(fn==="end_pause"){RC.resume()}
 else if(fn==="end_race"){raceActive=false;RC.stop();if(winnerTimer)clearTimeout(winnerTimer);winnerTimer=setTimeout(finalize,1500)}
 else if(fn==="abort_race"){raceActive=false;RC.stop();if(winnerTimer){clearTimeout(winnerTimer);winnerTimer=null}}
}
function finalize(){winnerTimer=null;if(lastFinalSec>0)RC.freezeAt(lastFinalSec*1000);var w=sorted()[0];if(w&&w.laps>0){winner=w;var x="🏆 "+t("lane")+" "+w.lane;$("race").textContent=x;$("race").classList.add("winner");ev(Date.now()/1000,x);speak(t("winner",{lane:t("lane"),n:w.lane}))}}
// ---- WS ----
function applyFrame(f){
 totC++;if(f.checksum_ok&&!(f.warnings&&f.warnings.length))okC++;$("cnt").textContent=okC+" / "+totC;
 if(f.device)$("dev").textContent=f.device;if(f.iso)$("ntp").textContent=f.iso.replace("T"," ").slice(0,19);
 logLine(f);
 if(f.data_type==="function"&&f.function){onFunction(f);
   raceFn=f.function;if(!winner)$("race").textContent=fnLabel(f.function);ev(f.ts,fnLabel(f.function));
   if(f.function!==lastSpoken){var isS=f.function.indexOf("start_race_phase")===0;var key=isS?"race_start":f.function;if(key!==lastSpoken){lastSpoken=key;if(f.function!=="end_race")speak(isS?t("start"):fnLabel(f.function))}}
 }
 if(f.lane&&(f.data_type==="timing_data"||f.data_type==="final_record_data")){
   var s=lanes[f.lane]||(lanes[f.lane]={laps:0,last:"",best:"",bestSec:null,cumul:0,cl:-1});
   if(f.laps!=null&&f.laps>=0)s.laps=f.laps;
   if(f.data_type==="timing_data"){lapsSinceStart++;if(f.time_text){s.last=f.time_text;
     var hadBest=s.bestSec!=null;var nb=f.time_seconds>0&&(s.bestSec==null||f.time_seconds<s.bestSec);if(nb){s.best=f.time_text;s.bestSec=f.time_seconds}f._fast=nb&&hadBest;
     if(f.time_seconds>0&&f.laps!==s.cl){s.cl=f.laps;s.cumul=(s.cumul||0)+f.time_seconds;var mx=0;for(var kk in lanes){if(lanes[kk].cumul>mx)mx=lanes[kk].cumul}RC.syncTo(mx*1000)}}}
   else if(f.data_type==="final_record_data"&&f.time_seconds>0){if(f.time_seconds>lastFinalSec)lastFinalSec=f.time_seconds}
   render();
 }
 if(f._fast&&f.lane&&f.time_text){ev(f.ts,t("fastlap")+" — "+t("lane")+" "+f.lane+" · "+f.time_text)}
 if(f.lane&&f.time_text&&f.data_type==="timing_data"){var k=f.lane+":"+f.laps;if(!announced[k]){announced[k]=1;var s2=t("lane")+" "+f.lane+", "+t("lapw")+" "+f.laps+", "+spokenTime(f);if(f._fast)s2+=", "+t("fastlap");speak(s2)}}
}
function applyState(s){if(s.device)$("dev").textContent=s.device;if(s.race)$("race").textContent=s.race;if(s.ok!=null){okC=s.ok;totC=s.total;$("cnt").textContent=okC+" / "+totC}
 if(s.lanes){lanes={};s.lanes.forEach(function(L){lanes[L.lane]={laps:L.laps,last:L.last,best:L.best,bestSec:L.bestSec}});render()}}
var ws;
function connect(){$("st").textContent=t("connecting");ws=new WebSocket("ws://"+location.host+"/ws");
 ws.onopen=function(){$("st").textContent=t("connected");$("st").className="status on"};
 ws.onclose=function(){$("st").textContent=t("reconnecting");$("st").className="status";setTimeout(connect,2000)};
 ws.onmessage=function(e){try{var m=JSON.parse(e.data);if(m.type==="state")applyState(m);else applyFrame(m)}catch(x){}}}
$("lang").value=lang;
$("lang").addEventListener("change",function(){lang=this.value;try{localStorage.setItem("ds200.lang",lang)}catch(e){}pickVoice();applyStatic()});
if(!ttsOK)$("ttsl").style.display="none";else $("tts").addEventListener("change",function(){if(this.checked){pickVoice();speak(t("ton"))}else speechSynthesis.cancel()});
fetch("/info").then(function(r){return r.json()}).then(function(j){if(j.version)$("ver").textContent="v"+j.version}).catch(function(){});
applyStatic();connect();
</script>
</body></html>)HTML";
