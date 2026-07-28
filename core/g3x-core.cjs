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
             zones:[[0,1800,"cold"],[1800,5500,"good"],[5500,5800,"warn"],[5800,1e9,"crit"]],
             note:"max. 5800 rpm (höchstens 5 min), Dauerleistung 5500 rpm, Leerlauf min. 1800 rpm" },
  map:     { label:"Ladedruck", unit:"inHg", dec:1,
             zones:[[0,45,"good"],[45,51,"warn"],[51,1e9,"crit"]],
             note:"max. 51 inHg (1730 hPa); Sollwert Start ca. 44,9 inHg (1520 hPa) — Vorwarnbereich abgeleitet" },
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

    const r = { sec, timeStr: t.slice(0,8), date: dateIdx >= 0 ? c[dateIdx] : "",
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

function episodes(rows, key, minDur = 3){
  const L = LIMITS[key];
  if (!L || !L.zones) return [];
  const out = [];
  let cur = null;
  const flush = () => {
    if (cur && cur.end - cur.start + 1 >= minDur) out.push(cur);
    cur = null;
  };
  for (const r of rows){
    const v = r[key];
    const running = r.rpm != null && r.rpm > 400;
    const z = running ? zoneOf(key, v) : null;
    if (z === "warn" || z === "crit" || (z === "cold" && key === "oilT" && r.ias != null && r.ias > 40)){
      const sev = z === "crit" ? "crit" : "warn";
      if (cur && cur.sev === sev && r.sec - cur.end <= 3){
        cur.end = r.sec; cur.endStr = r.timeStr;
        if (sev === "crit" ? v > cur.peak : Math.abs(v) > Math.abs(cur.peak)) cur.peak = v;
      } else {
        flush();
        cur = { key, sev, start:r.sec, end:r.sec, startStr:r.timeStr, endStr:r.timeStr, peak:v, zone:z };
      }
    } else flush();
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

/* Kurzzusammenfassung eines Flugs für die Zeitleiste.
   Version hochzählen, wenn sich die Struktur ändert -> gespeicherte
   Zusammenfassungen werden dann automatisch neu berechnet. */
const SUMMARY_VER = 3;
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

  return {
    ver: SUMMARY_VER,
    date: t0.date, start: t0.timeStr, end: t1.timeStr,
    startTs: Date.parse(t0.date + "T" + t0.timeStr) || 0,
    dur: t1.sec - t0.sec,
    runSecs, engStart, engEnd, type, trackLL,
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
  fmtDur, fmtNum, fmtDist, fmtDateDE,
};
});
