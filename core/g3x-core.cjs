/* ============================================================================
   G3X-Core — reiner Parser + Rotax-915iS-Grenzwerte + Flug-Klassifizierung.
   Single Source of Truth: läuft im Browser (hängt sich an window) UND in Node
   (module.exports). Keine DOM-Abhängigkeit.
   ==========================================================================*/
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else if (root) Object.assign(root, api);
})(typeof self !== "undefined" ? self
   : typeof globalThis !== "undefined" ? globalThis
   : this, function () {
"use strict";

const F2C = f => (f - 32) / 1.8;
const GAL2L = 3.785411784;

const LIMITS = {
  rpm:     { label:"Drehzahl", unit:"rpm", dec:0,
             zones:[[0,1800,"cold"],[1800,5500,"good"],[5500,5800,"warn"],[5800,1e9,"crit"]], allowS:300,
             note:"max. 5800 rpm (höchstens 5 min), Dauerleistung 5500 rpm, Leerlauf min. 1800 rpm — 5500–5800 rpm (Startleistung) wird erst nach 5 min gemeldet" },
  map:     { label:"Ladedruck", unit:"inHg", dec:1,
             zones:[[0,45,"good"],[45,51,"warn"],[51,1e9,"crit"]], allowS:300,
             note:"max. 51 inHg (1730 hPa); Sollwert Start ca. 44,9 inHg (1520 hPa) — Vorwarnbereich abgeleitet, wird wie die Startleistung erst nach 5 min gemeldet" },
  oilT:    { label:"Öltemperatur", unit:"°C", dec:1,
             zones:[[-999,50,"cold"],[50,110,"good"],[110,130,"warn"],[130,1e9,"crit"]],
             note:"Betrieb 50–130 °C, empfohlen 90–110 °C; Start erst ab 50 °C" },
  coolT:   { label:"Kühlmitteltemperatur", unit:"°C", dec:1,
             zones:[[-999,108,"good"],[108,120,"warn"],[120,1e9,"crit"]],
             note:"max. 120 °C; Vorwarnbereich ab 108 °C abgeleitet" },
  manT:    { label:"Ansauglufttemperatur", unit:"°C", dec:1,
             zones:[[-999,50,"good"],[50,80,"warn"],[80,1e9,"crit"]],
             note:"max. 80 °C; über 50 °C reduzierte Volldruckhöhe" },
  oilP:    { label:"Öldruck", unit:"psi", dec:1,
             zones:[[0,11.6,"crit"],[11.6,29,"warn"],[29,72.5,"good"],[72.5,101.5,"warn"],[101.5,1e9,"crit"]],
             note:"normal 29–72,5 psi (über 3500 rpm); min. 11,6 psi unter 3500 rpm; max. 101,5 psi bei Kaltstart" },
  fuelP:   { label:"Kraftstoffdruck", unit:"psi", dec:1,
             zones:[[0,36,"crit"],[36,42,"warn"],[42,45,"good"],[45,51,"warn"],[51,1e9,"crit"]],
             note:"Fuel Rail 42–45 psi; 36–51 psi nur kurzzeitig (max. 3 s) nach Lastwechsel" },
  egt:     { label:"Abgastemperatur (EGT)", unit:"°C", dec:0,
             zones:[[0,880,"good"],[880,950,"warn"],[950,1e9,"crit"]],
             note:"max. 950 °C; Vorwarnbereich ab 880 °C abgeleitet" },
  egtSplit:{ label:"EGT-Split", unit:"°C", dec:0,
             zones:[[0,150,"good"],[150,200,"warn"],[200,1e9,"crit"]],
             note:"max. 200 °C (bei Verbrauch > 3 l/h); Vorwarnbereich abgeleitet" },
  ff:      { label:"Verbrauch", unit:"l/h", dec:1, zones:null, note:"informativ" },
  amps:    { label:"Batteriestrom", unit:"A", dec:0, zones:null, note:"informativ" },
  volts:   { label:"Bordspannung", unit:"V", dec:1,
             zones:[[0,12.0,"crit"],[12.0,13.5,"warn"],[13.5,14.6,"good"],[14.6,15.2,"warn"],[15.2,1e9,"crit"]],
             note:"Richtwerte Bordnetz (nicht Rotax): Ladebetrieb ca. 13,8–14,4 V" },
  oat:     { label:"Außentemperatur", unit:"°C", dec:1,
             zones:[[-40,50,"good"],[50,1e9,"warn"]],
             note:"Betrieb -40 bis +50 °C" },
  alt:     { label:"Baro-Höhe", unit:"ft", dec:0, zones:null, note:"GPS-Höhe (WGS84) und barometrische Höhe können systembedingt abweichen" },
  gpsAlt:  { label:"GPS-Höhe", unit:"ft", dec:0, zones:null, note:"" },
  gndSpd:  { label:"Groundspeed", unit:"kt", dec:0, zones:null, note:"Groundspeed über GPS, IAS vom Staurohr" },
  ias:     { label:"IAS", unit:"kt", dec:0, zones:null, note:"" },
};

const KNOWN = {
  "RPM":"rpm", "Manifold Press (inch Hg)":"map", "Oil Press (PSI)":"oilP",
  "Oil Temp (deg F)":"oilT", "Coolant Temp (deg F)":"coolT", "Man Temp (deg F)":"manT",
  "Fuel Flow (gal/hour)":"ff", "Fuel Press (PSI)":"fuelP", "Batt Amps":"amps", "Batt Volts":"volts",
  "EGT1 (deg F)":"egt1", "EGT2 (deg F)":"egt2", "EGT3 (deg F)":"egt3", "EGT4 (deg F)":"egt4",
  "Outside Air Temp (deg C)":"oat", "Indicated Airspeed (kt)":"ias", "Baro Altitude (ft)":"alt",
  "Latitude (deg)":"lat", "Longitude (deg)":"lon",
  "GPS Altitude (ft)":"gpsAlt", "GPS Ground Speed (kt)":"gndSpd",
};
const F_COLS = new Set(["Oil Temp (deg F)","Coolant Temp (deg F)","Man Temp (deg F)",
  "EGT1 (deg F)","EGT2 (deg F)","EGT3 (deg F)","EGT4 (deg F)"]);
const SKIP_COLS = new Set([
  "Date (yyyy-mm-dd)","Time (hh:mm:ss)","UTC Time (hh:mm:ss)","UTC Offset (hh:mm)",
  "GPS Time of Week (sec)",
]);
/* Spalten, die als normale Messwerte-Spalte bleiben, für die Start-/Lande-
   erkennung aber zusätzlich unter einem festen Namen an jeder Zeile hängen. */
const ALIAS_COLS = {
  "Vertical Speed (ft/min)":"vs", "GPS Velocity U (m/sec)":"gpsVU",
};
const CAT_COLS = {
  "GPS Fix Status":"GPS-Fix", "Active Nav Source":"Nav-Quelle", "Nav Annunciation":"Nav-Anzeige",
  "Nav Identifier":"Nav-Kennung", "Horizontal CDI Scale":"CDI-Skala",
  "Autopilot State":"Autopilot", "FD Lateral Mode":"FD lateral", "FD Vertical Mode":"FD vertikal",
  "AHRS/Mag 1 Status":"AHRS/Mag 1", "SFD AHRS Status":"SFD AHRS", "AFCS Attitude Status":"AFCS-Lage",
  "Network Status":"Netzwerk", "Transponder Code":"Transponder-Code", "Transponder Mode":"Transponder-Modus",
  "Flap Position":"Klappenstellung", "BATT LOW (discrete)":"BATT LOW", "DISCRETE":"Discrete",
  "Terrain Alert":"Terrain-Warnung", "Event Marker":"Ereignismarker", "COM Frequency (MHz)":"COM-Frequenz",
};

function splitCsvLine(line){
  return line.split(",").map(s => s.replace(/^"|"$/g, "").trim());
}

function parseG3X(text){
  const lines = text.split(/\r?\n/);
  let i = 0;
  const info = {};
  if (lines[0] && lines[0].startsWith("#")){
    for (const m of lines[0].matchAll(/(\w+)="([^"]*)"/g)) info[m[1]] = m[2];
    i = 1;
  }
  const header = splitCsvLine(lines[i]); i++;
  if (lines[i] && /^Lcl Date/i.test(lines[i])) i++;

  const timeIdx = header.indexOf("Time (hh:mm:ss)");
  const dateIdx = header.indexOf("Date (yyyy-mm-dd)");
  const casIdx  = header.indexOf("CAS Alert");
  const utcIdx  = header.indexOf("UTC Time (hh:mm:ss)");
  const offIdx  = header.indexOf("UTC Offset (hh:mm)");
  if (timeIdx < 0 || header.indexOf("RPM") < 0)
    throw new Error("Das sieht nicht nach einem G3X-Log aus (Spalten 'Time'/'RPM' fehlen).");

  const catalog = header.map((name, idx) => {
    if (idx === casIdx || name === "") return { name, idx, kind:"cas" };
    if (SKIP_COLS.has(name)) return { name, idx, kind:"skip" };
    if (KNOWN[name]) return { name, idx, kind:"known", key: KNOWN[name] };
    if (CAT_COLS[name]) return { name, idx, kind:"cat", label: CAT_COLS[name], events:[], last:undefined, n:0 };
    return { name, idx, kind:"num", key:"c"+idx, hasData:false, min:Infinity, max:-Infinity };
  });
  const numCols = catalog.filter(c => c.kind === "num");
  const catCols = catalog.filter(c => c.kind === "cat");

  const num = s => { const v = parseFloat(s); return Number.isFinite(v) ? v : null; };
  const rows = [];
  let day = 0, prevSec = null;
  for (; i < lines.length; i++){
    const line = lines[i];
    if (!line || line.startsWith("#")) continue;
    const c = splitCsvLine(line);
    if (c.length < header.length - 5) continue;
    const t = c[timeIdx];
    if (!/^\d\d:\d\d:\d\d/.test(t)) continue;
    let sec = +t.slice(0,2)*3600 + +t.slice(3,5)*60 + +t.slice(6,8);
    if (prevSec !== null && sec + day*86400 < prevSec) day++;
    sec += day*86400;
    prevSec = sec;

    const uraw = utcIdx >= 0 ? (c[utcIdx] || "") : "";
    const r = { sec, timeStr: t.slice(0,8), date: dateIdx >= 0 ? c[dateIdx] : "",
                utc: /^\d\d:\d\d:\d\d/.test(uraw) ? uraw.slice(0,8) : "",
                utcOff: offIdx >= 0 ? (c[offIdx] || "") : "",
                cas: casIdx >= 0 ? (c[casIdx] || "") : "" };
    for (const col of catalog){
      if (col.kind === "known"){
        let v = num(c[col.idx]);
        if (v != null){
          if (F_COLS.has(col.name)) v = F2C(v);
          if (col.key === "ff") v *= GAL2L;
          if (col.key === "rpm" && v <= 0) v = null;
        }
        r[col.key] = v;
      } else if (col.kind === "num"){
        const v = num(c[col.idx]);
        r[col.key] = v;
        if (ALIAS_COLS[col.name]) r[ALIAS_COLS[col.name]] = v;
        if (v != null){ col.hasData = true;
          if (v < col.min) col.min = v;
          if (v > col.max) col.max = v; }
      } else if (col.kind === "cat"){
        const v = c[col.idx] || "";
        if (v !== "") col.n++;
        if (v !== col.last){
          col.events.push({ sec, timeStr: r.timeStr, val: v });
          col.last = v;
        }
      }
    }
    const e = [r.egt1, r.egt2, r.egt3, r.egt4];
    const eOn = e.filter(v => v != null && v > 100);
    r.egtSplit = eOn.length >= 2 ? Math.max(...eOn) - Math.min(...eOn) : null;
    rows.push(r);
  }
  if (!rows.length) throw new Error("Keine Datenzeilen gefunden.");
  return { info, rows, catalog, numCols, catCols };
}

function zoneOf(key, v){
  const L = LIMITS[key];
  if (!L || !L.zones || v == null) return null;
  for (const [a,b,s] of L.zones) if (v >= a && v < b) return s;
  return null;
}
const SEVERITY = { good:0, cold:1, warn:1, crit:2 };

function stats(rows, key, L){
  L = L || LIMITS[key];
  const zoned = L && L.zones && key !== "rpm";
  let min=Infinity, max=-Infinity, sum=0, n=0, worst=0;
  for (const r of rows){
    if (zoned && !(r.rpm != null && r.rpm > 400)) continue;
    const v = r[key];
    if (v == null) continue;
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v; n++;
    const z = zoneOf(key, v);
    if (z === "warn" || z === "crit") worst = Math.max(worst, SEVERITY[z]);
  }
  return n ? { min, max, avg: sum/n, n, worst } : null;
}

/* Grenzwert-Episoden. Eine Episode = Zeit außerhalb des grünen Bereichs;
   Unterbrechungen bis 30 s werden zusammengefasst — ein Wert, der um eine
   Grenze pendelt, ergibt EINEN Eintrag statt dreißig. Gemeldet wird nur, was
     - mindestens 3 s im roten Bereich lag (rot), oder
     - mindestens 10 s außerhalb Grün lag (gelb) und, bei zeitlich begrenzt
       zulässigen Bereichen (allowS: Startleistung max. 5 min), länger dauerte.
   Öldruck 11,6–29 psi ist unter 3500 rpm (Leerlauf, Rollen) normal. */
const MERGE_S = 30, MIN_CRIT_S = 3, MIN_WARN_S = 10;
function episodes(rows, key){
  const L = LIMITS[key];
  if (!L || !L.zones) return [];
  const good = L.zones.find(z => z[2] === "good");
  const mid = good ? (Math.max(good[0], -1e6) + Math.min(good[1], 1e6)) / 2 : 0;
  const out = [];
  let cur = null, prevBad = false;
  const flush = () => {
    if (!cur) return;
    const span = cur.end - cur.start + 1;
    const sev = cur.secsCrit >= MIN_CRIT_S ? "crit"
              : cur.secs >= MIN_WARN_S && !(L.allowS && span <= L.allowS) ? "warn" : null;
    if (sev) out.push({ key, sev, start:cur.start, end:cur.end, startStr:cur.startStr, endStr:cur.endStr,
                        peak:cur.peak, secs: sev === "crit" ? cur.secsCrit : cur.secs, n:cur.n });
    cur = null;
  };
  for (const r of rows){
    const v = r[key];
    const running = r.rpm != null && r.rpm > 400;
    let z = running ? zoneOf(key, v) : null;
    if (key === "oilP" && z === "warn" && v < mid && r.rpm < 3500) z = null;
    const bad = z === "warn" || z === "crit" || (z === "cold" && key === "oilT" && r.ias != null && r.ias > 40);
    if (!bad){ prevBad = false; continue; }
    if (cur && r.sec - cur.end > MERGE_S) flush();
    if (!cur) cur = { start:r.sec, startStr:r.timeStr, end:r.sec, endStr:r.timeStr,
                      secs:0, secsCrit:0, n:0, peak:v, low: v < mid };
    if (!prevBad) cur.n++;
    cur.secs++;
    if (z === "crit") cur.secsCrit++;
    cur.end = r.sec; cur.endStr = r.timeStr;
    if (cur.low ? v < cur.peak : v > cur.peak) cur.peak = v;
    prevBad = true;
  }
  flush();
  return out;
}

function allEpisodes(rows){
  const out = [];
  for (const k of Object.keys(LIMITS)) if (k !== "egt" && !/^egt\d/.test(k)) out.push(...episodes(rows, k));
  for (const cyl of ["egt1","egt2","egt3","egt4"]){
    if (!LIMITS[cyl]) LIMITS[cyl] = { ...LIMITS.egt, label:"EGT " + cyl.slice(-1) };
    out.push(...episodes(rows, cyl));
  }
  out.sort((a,b) => a.start - b.start);
  return out;
}

/* Track-Punkte + Strecke (GPS-Zittern < 2 m wird nicht aufsummiert) */
function computeTrack(rows){
  const pts = rows.filter(r => r.lat != null && r.lon != null && Math.abs(r.lat) > 0.5);
  if (pts.length < 2) return null;
  const R = 6371000, rad = d => d * Math.PI / 180;
  let dist = 0;
  for (let i = 1; i < pts.length; i++){
    const a = pts[i-1], b = pts[i];
    const h = Math.sin(rad(b.lat-a.lat)/2)**2 +
              Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon-a.lon)/2)**2;
    const seg = 2 * R * Math.asin(Math.sqrt(h));
    if (seg > 2) dist += seg;
  }
  return { pts, dist };
}

/* ---------- UTC ----------
   G3X loggt Lokalzeit UND UTC-Zeit ("UTC Time") samt Zonenversatz
   ("UTC Offset", z. B. "+02:00"). Fehlt die UTC-Spalte in einzelnen Zeilen
   (z. B. vor dem GPS-Fix), rechnen wir sie aus dem Versatz zurück. */
const hms = s => +s.slice(0,2)*3600 + +s.slice(3,5)*60 + +s.slice(6,8);
function clockStr(sec){
  sec = ((Math.round(sec) % 86400) + 86400) % 86400;
  const p = n => String(n).padStart(2, "0");
  return `${p(Math.floor(sec/3600))}:${p(Math.floor(sec/60)%60)}:${p(sec%60)}`;
}
/* Zonenversatz des Logs in Minuten (Lokalzeit = UTC + Versatz), sonst null. */
function utcOffsetMin(rows){
  for (const r of rows){
    const m = /^([+-])(\d\d):(\d\d)$/.exec((r.utcOff || "").trim());
    if (m) return (m[1] === "-" ? -1 : 1) * (+m[2]*60 + +m[3]);
  }
  for (const r of rows){
    if (!r.utc || !r.timeStr) continue;
    let d = Math.round((hms(r.timeStr) - hms(r.utc)) / 60);
    if (d >  840) d -= 1440;          // über Mitternacht
    if (d < -840) d += 1440;
    return Math.round(d / 15) * 15;   // Zeitzonen sind Vielfache von 15 min
  }
  return null;
}
const offsetStr = min => min == null ? ""
  : `${min < 0 ? "-" : "+"}${String(Math.floor(Math.abs(min)/60)).padStart(2,"0")}:${String(Math.abs(min)%60).padStart(2,"0")}`;
/* UTC-Uhrzeit einer Zeile: bevorzugt die geloggte Spalte, sonst gerechnet. */
function utcOf(row, offMin){
  if (row && row.utc) return row.utc;
  if (!row || offMin == null) return "";
  return clockStr(hms(row.timeStr) - offMin*60);
}

/* ---------- Start und Landung ----------
   Start: der ERSTE Start im Log — Beginn des Startlaufs (Bremsen lösen bzw.
   Beginn der Beschleunigung bei rollendem Start) bis zum Abheben.
   Landung: die LETZTE Landung im Log — Aufsetzen bis Ausrollen auf
   Rollgeschwindigkeit. Dazwischen liegende Platzrunden/Touch&Go zählen nicht.

   Strecke = Integral der GPS-Groundspeed über die Zeit (Trapezregel). Das ist
   genauer als „Zeit × Geschwindigkeit“ (die Beschleunigung ist nicht linear)
   und robuster als das Aufsummieren der GPS-Positionen (Zittern). Ergebnis ist
   die Strecke ÜBER GRUND — also inklusive Wind- und Pistenneigungseinfluss,
   genau wie eine am Platz gemessene Roll-/Landestrecke.

   Abheben/Aufsetzen werden an der Steig-/Sinkrate erkannt (ADAHRS „Vertical
   Speed“ und GPS-Vertikalgeschwindigkeit, Mittel aus beiden), nicht allein an
   der Baro-Höhe: die zeigt am Boden ±5 ft Rauschen und springt während des
   Startlaufs durch den Staudruckfehler am statischen Anschluss. */
const KT2MS = 0.514444;
const AIR_KT = 45, HOLD_S = 20, WIN_S = 180;
const TAXI_KT = 10;                       // Ende des Ausrollens
const altOf = r => r.alt ?? r.gpsAlt ?? null;
const median = a => { const s = [...a].sort((x,y) => x-y); return s.length ? s[s.length >> 1] : null; };

/* Wert einer Spalte zur (Bruch-)Sekunde t, linear zwischen zwei Messpunkten. */
function valAt(rows, t, key){
  let a = 0, b = rows.length - 1;
  if (t <= rows[a].sec) return rows[a][key] ?? null;
  if (t >= rows[b].sec) return rows[b][key] ?? null;
  while (b - a > 1){ const m = (a+b) >> 1; (rows[m].sec <= t) ? a = m : b = m; }
  const va = rows[a][key], vb = rows[b][key];
  if (va == null || vb == null) return va ?? vb ?? null;
  const f = (t - rows[a].sec) / Math.max(1e-9, rows[b].sec - rows[a].sec);
  return va + (vb - va) * f;
}
/* Strecke über Grund zwischen den Zeitpunkten tA und tB (Meter). */
function integrateGs(rows, tA, tB){
  let m = 0;
  for (let i = 1; i < rows.length; i++){
    const t0 = rows[i-1].sec, t1 = rows[i].sec;
    if (t1 <= tA) continue;
    if (t0 >= tB) break;
    const dt = t1 - t0;
    if (dt <= 0 || dt > 5) continue;            // Lücke im Log -> nicht raten
    const v0 = rows[i-1].gndSpd, v1 = rows[i].gndSpd;
    if (v0 == null || v1 == null) continue;
    const a = Math.max(t0, tA), b = Math.min(t1, tB);
    const va = v0 + (v1 - v0) * (a - t0) / dt, vb = v0 + (v1 - v0) * (b - t0) / dt;
    m += (va + vb) / 2 * KT2MS * (b - a);
  }
  return m;
}
/* Steig-/Sinkrate in ft/min: Mittel aus ADAHRS-Vario und GPS-Vertikal-
   geschwindigkeit; fehlen beide, aus der Höhenänderung gerechnet — über die
   3 s davor (side = -1, Abheben) bzw. 6 s danach (side = +1, Aufsetzen), damit
   der Knick nicht in die Nachbarsekunden verschmiert. Nach dem Aufsetzen ist
   das Fenster länger, weil dort nur das Rauschen der Baro-Höhe am Boden stört. */
function vsOf(rows, i, side){
  const r = rows[i];
  let s = 0, k = 0;
  if (r.vs != null){ s += r.vs; k++; }
  if (r.gpsVU != null){ s += r.gpsVU * 196.8504; k++; }
  if (k) return s / k;
  // Ausgleichsgerade — für eine Differenz zweier Punkte rauscht die Baro-Höhe zu stark
  let n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
  const j0 = side > 0 ? i : Math.max(0, i-3), j1 = side > 0 ? Math.min(rows.length-1, i+6) : i;
  for (let j = j0; j <= j1; j++){
    const h = altOf(rows[j]);
    if (h == null) continue;
    const x = rows[j].sec - r.sec;
    n++; sx += x; sy += h; sxx += x*x; sxy += x*h;
  }
  const den = n * sxx - sx * sx;
  return n >= 3 && den > 0 ? (n * sxy - sx * sy) / den * 60 : null;
}
/* Zeitpunkt, zu dem die Höhe `target` durchstoßen wird — aus einer Geraden
   durch die ersten Steigflug- (dir = +1, ab idx) bzw. letzten Sinkflug-
   Sekunden (dir = -1, bis idx-1) gerechnet statt auf die volle Sekunde
   gerundet. Das Ergebnis bleibt im Intervall [idx-1, idx]. */
function crossingTime(rows, idx, target, dir){
  const pts = [];
  const from = dir > 0 ? idx : Math.max(0, idx - 7), to = dir > 0 ? Math.min(rows.length-1, idx + 6) : idx - 1;
  for (let i = from; i <= to; i++){
    const a = altOf(rows[i]);
    if (a != null) pts.push([rows[i].sec, a]);
  }
  const lo = rows[Math.max(0, idx-1)].sec, hi = rows[idx].sec;
  if (pts.length < 2) return hi;
  const t0 = pts[0][0];
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const [t, a] of pts){ const x = t - t0; sx += x; sy += a; sxx += x*x; sxy += x*a; }
  const den = pts.length * sxx - sx * sx;
  if (den === 0) return hi;
  const slope = (pts.length * sxy - sx * sy) / den;      // ft/s
  const icept = (sy - slope * sx) / pts.length;
  if (dir * slope <= 0.5) return hi;                     // kein plausibler Steig-/Sinkflug
  return Math.min(hi, Math.max(lo, t0 + (target - icept) / slope));
}
/* Erste (dir = +1) bzw. letzte (dir = -1) anhaltende Flugphase:
   Groundspeed > 45 kt, und in den 20 s danach (davor) nie unter 30 kt. */
function sustainedAir(rows, dir){
  const n = rows.length;
  for (let i = dir > 0 ? 0 : n - 1; i >= 0 && i < n; i += dir){
    if ((rows[i].gndSpd ?? 0) <= AIR_KT) continue;
    const tEnd = rows[i].sec + dir * HOLD_S;
    let j = i, ok = true;
    for (; j >= 0 && j < n && dir * (tEnd - rows[j].sec) >= 0; j += dir)
      if ((rows[j].gndSpd ?? 0) <= 30){ ok = false; break; }
    const edge = rows[Math.min(n-1, Math.max(0, j))];
    if (ok && dir * (edge.sec - tEnd) >= 0) return i;
    i = j;
  }
  return -1;
}
/* Platzhöhe = Median der Höhe, solange das Flugzeug sicher rollt (unter
   30 kt Groundspeed und — falls geloggt — unter 38 kt IAS). */
function fieldElev(rows, a, b){
  const alts = [];
  for (let i = Math.max(0, a); i <= Math.min(rows.length-1, b); i++){
    const r = rows[i], h = altOf(r);
    if (h == null || r.gndSpd == null || r.gndSpd >= 30) continue;
    if (r.ias != null && r.ias >= 38) continue;
    alts.push(h);
  }
  return alts.length >= 3 ? median(alts) : null;
}
/* Uhrzeit (lokal + UTC) eines Bruch-Zeitpunkts. */
function clockAt(t, offMin){
  return { str: clockStr(t), utc: offMin == null ? "" : clockStr(t - offMin*60) };
}

function detectTakeoff(rows){
  const n = rows.length;
  if (n < 20) return null;
  const gs = i => rows[i].gndSpd ?? 0;

  // 1) Erste anhaltende Flugphase.
  const air = sustainedAir(rows, +1);
  if (air < 0) return null;

  // 2) Rollbeginn: vom letzten Punkt unter 12 kt aus so weit zurück, wie die
  //    Geschwindigkeit noch abnimmt (= Beschleunigungsphase). Endet das im
  //    Stand, ist das „Bremsen lösen“; sonst ein rollender Start (Beginn der
  //    Beschleunigung). Rollen/Backtrack davor zählt so nicht mit.
  let k = air;
  while (k > 0 && gs(k) > 12 && rows[air].sec - rows[k].sec <= 90) k--;
  if (gs(k) > 12) return null;
  let roll = k;
  while (roll > 0 && rows[roll].sec - rows[roll-1].sec <= 5){
    const cur = gs(roll);
    if (gs(roll-1) < cur - 0.3 || (roll > 1 && gs(roll-2) < cur - 0.6)) roll--;
    else break;
  }
  const method = gs(roll) < 3 ? "brakerelease" : "rolling";
  if (roll >= n - 2) return null;

  // 3) Platzhöhe aus dem Startlauf selbst (dort, wo sicher noch gerollt wird),
  //    ersatzweise aus den 10 s vor dem Losrollen.
  let field = fieldElev(rows, roll, air);
  if (field == null){
    let a = roll;
    while (a > 0 && rows[roll].sec - rows[a-1].sec <= 10) a--;
    const alts = [];
    for (let i = a; i <= roll; i++){ const h = altOf(rows[i]); if (h != null) alts.push(h); }
    field = median(alts);
  }
  if (field == null) return null;

  // 4) Abheben: eindeutigen Steigflug (+50 ft über Platz) suchen, dann zurück,
  //    solange noch gestiegen wird (Steigrate ≥ 100 ft/min).
  let climb = -1;
  for (let i = roll + 1; i < n && rows[i].sec - rows[roll].sec <= WIN_S; i++){
    const a = altOf(rows[i]);
    if (a != null && a - field >= 50){ climb = i; break; }
  }
  if (climb < 0) return null;
  let lift = climb;
  while (lift > roll + 1){
    const v = vsOf(rows, lift - 1, -1);
    if (v != null && v >= 100) lift--; else break;
  }

  const rollT  = rows[roll].sec;
  const liftT  = crossingTime(rows, lift, field, +1);
  const climbT = Math.max(liftT, crossingTime(rows, climb, field + 50, +1));
  const dur    = liftT - rollT;
  const liftGs = valAt(rows, liftT, "gndSpd");
  if (dur < 3 || dur > 120) return null;          // unplausibel -> lieber nichts zeigen
  if (liftGs == null || liftGs < 20) return null;

  const distRoll = integrateGs(rows, rollT, liftT);
  const dist50   = integrateGs(rows, rollT, climbT);
  if (!(distRoll > 30)) return null;

  const offMin = utcOffsetMin(rows);
  const cR = clockAt(rollT, offMin), cL = clockAt(liftT, offMin), c50 = clockAt(climbT, offMin);
  return {
    rollSec: rollT, rollStr: cR.str, rollUtc: utcOf(rows[roll], offMin) || cR.utc,
    liftSec: liftT, liftStr: cL.str, liftUtc: cL.utc,
    sec50: climbT, str50: c50.str, utc50: c50.utc,
    dur, dur50: climbT - rollT,
    distRoll, dist50,
    liftGs, liftIas: valAt(rows, liftT, "ias"),
    liftRpm: rows[lift].rpm ?? null, liftMap: rows[lift].map ?? null,
    field, oat: rows[roll].oat ?? null,
    method,
  };
}

function detectLanding(rows){
  const n = rows.length;
  if (n < 20) return null;
  const gs = i => rows[i].gndSpd;

  // 1) Letzte anhaltende Flugphase, danach das Ausrollen auf Rollgeschwindigkeit.
  const last = sustainedAir(rows, -1);
  if (last < 0) return null;
  let slow = -1;
  for (let i = last + 1; i < n && rows[i].sec - rows[last].sec <= WIN_S + 300; i++)
    if (gs(i) != null && gs(i) <= TAXI_KT){ slow = i; break; }
  if (slow < 0) return null;                      // Log endet vor dem Ausrollen

  // 2) Platzhöhe aus dem Ausrollen und den ersten Rollsekunden danach.
  let endIdx = slow;
  while (endIdx < n - 1 && rows[endIdx+1].sec - rows[slow].sec <= 15) endIdx++;
  let startIdx = slow;
  while (startIdx > 0 && rows[slow].sec - rows[startIdx-1].sec <= 60) startIdx--;
  const field = fieldElev(rows, startIdx, endIdx);
  if (field == null) return null;

  // 3) Endanflug: letzter Punkt vor dem Ausrollen mehr als 50 ft über Platz.
  let fin = -1;
  for (let i = slow; i >= 0 && rows[slow].sec - rows[i].sec <= WIN_S + 300; i--){
    const a = altOf(rows[i]);
    if (a != null && a - field >= 50){ fin = i; break; }
  }
  if (fin < 0 || fin >= slow - 1) return null;

  // 4) Aufsetzen: vom Ausrollen aus zurück, solange das Flugzeug am Boden ist
  //    (nahe Platzhöhe und kein nennenswertes Sinken mehr).
  let td = slow;
  while (td > fin + 1){
    const a = altOf(rows[td-1]), v = vsOf(rows, td-1, +1);
    if (a != null && a - field <= 10 && (v == null || v > -120)) td--; else break;
  }

  const tdT = crossingTime(rows, td, field, -1);
  // 50 ft über Platz im Endanflug (linear zwischen fin und fin+1)
  const hA = altOf(rows[fin]) - field, hB = altOf(rows[fin+1]);
  const f50 = hB == null ? 0 : Math.min(1, Math.max(0, (hA - 50) / Math.max(1e-6, hA - (hB - field))));
  const t50 = Math.min(tdT, rows[fin].sec + f50 * (rows[fin+1].sec - rows[fin].sec));
  // Ende des Ausrollens: Groundspeed fällt auf 10 kt (linear interpoliert)
  const g0 = gs(slow-1), g1 = gs(slow);
  const fS = (g0 == null || g0 <= g1) ? 1 : Math.min(1, Math.max(0, (g0 - TAXI_KT) / (g0 - g1)));
  const stopT = Math.max(tdT, rows[slow-1].sec + fS * (rows[slow].sec - rows[slow-1].sec));

  const dur = stopT - tdT;
  const tdGs = valAt(rows, tdT, "gndSpd");
  if (dur < 2 || dur > 120) return null;
  if (tdGs == null || tdGs < 20) return null;
  const distRoll = integrateGs(rows, tdT, stopT);
  const dist50   = integrateGs(rows, t50, stopT);
  if (!(distRoll > 20)) return null;

  const offMin = utcOffsetMin(rows);
  const cT = clockAt(tdT, offMin), cS = clockAt(stopT, offMin), c50 = clockAt(t50, offMin);
  return {
    sec50: t50, str50: c50.str, utc50: c50.utc,
    tdSec: tdT, tdStr: cT.str, tdUtc: cT.utc,
    stopSec: stopT, stopStr: cS.str, stopUtc: cS.utc,
    dur, dur50: stopT - t50,
    distRoll, dist50,
    tdGs, tdIas: valAt(rows, tdT, "ias"),
    gs50: valAt(rows, t50, "gndSpd"), ias50: valAt(rows, t50, "ias"),
    field, oat: rows[slow].oat ?? null,
  };
}

/* Kurzzusammenfassung eines Flugs für die Zeitleiste.
   Version hochzählen, wenn sich die Struktur ändert -> gespeicherte
   Zusammenfassungen werden dann automatisch neu berechnet. */
const SUMMARY_VER = 6;
function summarize(parsed){
  const rows = parsed.rows;
  const t0 = rows[0], t1 = rows[rows.length-1];
  const track = computeTrack(rows);
  const eps = allEpisodes(rows);
  const casSet = new Set();
  for (const r of rows) if (r.cas) for (const m of r.cas.split("/")) if (m.trim()) casSet.add(m.trim());
  const g = k => stats(rows, k);

  // Motorlauf-Fenster und Klassifizierung.
  // "Abgehoben" nur über GPS-Groundspeed und Strecke — IAS/TAS liefern beim
  // Einschalten oft Störwerte (z. B. 151 kt TAS im Stand) und sind ungeeignet.
  let engStart = null, engEnd = null, runSecs = 0, airSecs = 0;
  for (const r of rows){
    if (r.rpm != null && r.rpm > 400){
      runSecs++;
      if (engStart == null) engStart = r.sec;
      engEnd = r.sec;
    }
    if ((r.gndSpd ?? 0) > 35) airSecs++;
  }
  const dist = track ? track.dist : 0;
  // Ohne gelaufenen Motor kann es weder Flug noch Standlauf sein.
  const type = runSecs <= 15 ? "panel"
             : (airSecs > 15 || dist > 3000) ? "flight"
             : "ground";

  // Vereinfachter Track für die Übersichtskarte (~240 Punkte)
  let trackLL = null;
  if (track){
    const p = track.pts, step = Math.max(1, Math.ceil(p.length / 240));
    trackLL = [];
    for (let i = 0; i < p.length; i += step)
      trackLL.push([Math.round(p[i].lat*1e5)/1e5, Math.round(p[i].lon*1e5)/1e5]);
    trackLL.push([Math.round(p[p.length-1].lat*1e5)/1e5, Math.round(p[p.length-1].lon*1e5)/1e5]);
  }

  const offMin = utcOffsetMin(rows);
  const takeoff = type === "flight" ? detectTakeoff(rows) : null;
  const landing = type === "flight" ? detectLanding(rows) : null;
  const airTime = takeoff && landing && landing.tdSec > takeoff.liftSec ? landing.tdSec - takeoff.liftSec : null;

  return {
    ver: SUMMARY_VER,
    date: t0.date, start: t0.timeStr, end: t1.timeStr,
    startUtc: utcOf(t0, offMin), endUtc: utcOf(t1, offMin),
    utcOff: offsetStr(offMin), utcOffMin: offMin,
    startTs: Date.parse(t0.date + "T" + t0.timeStr) || 0,
    dur: t1.sec - t0.sec,
    runSecs, engStart, engEnd, type, trackLL,
    takeoff, landing, airTime,
    dist,
    maxAlt: g("alt")?.max ?? null, maxIas: g("ias")?.max ?? null,
    maxRpm: g("rpm")?.max ?? null, maxOilT: g("oilT")?.max ?? null,
    maxCoolT: g("coolT")?.max ?? null, fuelAvg: g("ff")?.avg ?? null,
    nCrit: eps.filter(e => e.sev === "crit").length,
    nWarn: eps.filter(e => e.sev === "warn").length,
    nCas: casSet.size,
  };
}
const TYPE_META = {
  flight: { icon:"✈️", label:"Flug" },
  ground: { icon:"🔧", label:"Standlauf" },
  panel:  { icon:"🔌", label:"Nur Avionik" },
};

function fmtDur(s){
  s = Math.round(s);
  if (s < 60) return s + " s";
  const m = Math.floor(s/60), r = s % 60;
  if (m < 60) return r ? `${m} min ${r} s` : `${m} min`;
  return `${Math.floor(m/60)} h ${m%60} min`;
}
function fmtNum(v, dec){
  return v == null ? "–" : v.toLocaleString("de-AT",{minimumFractionDigits:dec,maximumFractionDigits:dec});
}
function fmtDist(dist){
  const nm = dist / 1852, km = dist / 1000;
  return dist < 1852 ? `${fmtNum(dist,0)} m` : `${fmtNum(nm, nm<10?1:0)} NM (${fmtNum(km, km<10?1:0)} km)`;
}
function fmtDateDE(iso){
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const [y,m,d] = iso.split("-");
  const wd = ["So","Mo","Di","Mi","Do","Fr","Sa"][new Date(+y, m-1, +d).getDay()];
  return `${wd}, ${d}.${m}.${y}`;
}

return {
  F2C, GAL2L, LIMITS, TYPE_META, SUMMARY_VER,
  parseG3X, zoneOf, stats, episodes, allEpisodes, computeTrack, summarize,
  utcOffsetMin, utcOf, offsetStr, clockStr, detectTakeoff, detectLanding, integrateGs, valAt,
  fmtDur, fmtNum, fmtDist, fmtDateDE,
};
});
