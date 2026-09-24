// Synthetischer G3X-Log eines kompletten Flugs — Grundlage für die Tests der
// Start- und Landeerkennung. Physik: gleichmäßige Beschleunigung bis Vr,
// Steigflug, Reiseflug, Sinkflug bis zum Aufsetzen, gleichmäßiges Verzögern.
// Die erwarteten Werte sind damit analytisch nachrechenbar.
const KT = 0.514444;

const HEADER = [
  "Date (yyyy-mm-dd)", "Time (hh:mm:ss)", "UTC Time (hh:mm:ss)", "UTC Offset (hh:mm)",
  "Latitude (deg)", "Longitude (deg)", "GPS Altitude (ft)", "GPS Ground Speed (kt)",
  "GPS Velocity U (m/sec)", "Baro Altitude (ft)", "Vertical Speed (ft/min)",
  "Indicated Airspeed (kt)", "Outside Air Temp (deg C)",
  "Manifold Press (inch Hg)", "RPM", "Oil Press (PSI)", "Oil Temp (deg F)",
  "Coolant Temp (deg F)", "Man Temp (deg F)", "Fuel Flow (gal/hour)", "Fuel Press (PSI)",
  "Batt Amps", "Batt Volts", "EGT1 (deg F)", "EGT2 (deg F)", "EGT3 (deg F)", "EGT4 (deg F)",
  "CAS Alert",
];

/**
 * @param {object} o
 * @param {number} o.idleS    Sekunden Stillstand vor dem Losrollen
 * @param {number} o.taxiS    Sekunden Rollen mit taxiKt direkt davor (rollender Start / Backtrack)
 * @param {number} o.taxiKt   Rollgeschwindigkeit beim rollenden Start
 * @param {number} o.rollS    Dauer des Startlaufs bis zum Abheben
 * @param {number} o.vrKt     Groundspeed beim Abheben
 * @param {number} o.dipFt    Baro-Höhenfehler im Startlauf bei Vr (Staudruckfehler, ~v²)
 * @param {number} o.climbS   Sekunden Steigflug danach (12 ft/s)
 * @param {number} o.cruiseS  Sekunden Reiseflug
 * @param {number} o.tdKt     Groundspeed beim Aufsetzen
 * @param {number} o.decelKt  Verzögerung im Ausrollen (kt/s)
 * @param {boolean} o.vario   Vario-/GPS-Vertikalspalten befüllen (sonst leer)
 * @param {number} o.noise    Seed für Messrauschen (Baro ±5 ft, GS ±0,4 kt, Vario ±60 ft/min); 0 = ohne
 * @param {number} o.fieldFt  Platzhöhe
 * @param {string} o.date     Datum (yyyy-mm-dd)
 * @param {number} o.offMin   Zonenversatz in Minuten (Lokalzeit = UTC + offMin)
 */
export function makeTakeoffCsv(o = {}) {
  const idleS  = o.idleS  ?? 40;
  const taxiS  = o.taxiS  ?? 0;
  const taxiKt = o.taxiKt ?? 8;
  const rollS  = o.rollS  ?? 18;
  const vrKt   = o.vrKt   ?? 50;
  const dipFt  = o.dipFt  ?? 0;
  const climbS = o.climbS ?? 120;
  const cruiseS= o.cruiseS?? 300;
  const tdKt   = o.tdKt   ?? 55;
  const decelKt= o.decelKt?? 3;
  const vario  = o.vario  ?? true;
  const noise  = o.noise  ?? 0;
  const fieldFt= o.fieldFt?? 1200;
  const date   = o.date   ?? "2026-05-16";
  const offMin = o.offMin ?? 120;
  const startLocal = 11 * 3600 + 35 * 60;          // 11:35:00 Lokalzeit

  const clock = (s) => {
    s = ((Math.round(s) % 86400) + 86400) % 86400;
    const p = (n) => String(n).padStart(2, "0");
    return `${p(Math.floor(s / 3600))}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}`;
  };
  const off = `${offMin < 0 ? "-" : "+"}` +
    `${String(Math.floor(Math.abs(offMin) / 60)).padStart(2, "0")}:` +
    `${String(Math.abs(offMin) % 60).padStart(2, "0")}`;

  let seed = noise;                                 // deterministisches Rauschen (LCG)
  const rnd = (amp) => {
    if (!noise) return 0;
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return (seed / 2147483648 * 2 - 1) * amp;
  };

  const rows = [];
  let prevAlt = fieldFt;
  const push = (t, gsKt, altFt, rpm, baroErr = 0) => {
    const lat = 48.1 + t * 1e-4, lon = 14.2 + t * 1e-4;
    const vsFpm = (altFt - prevAlt) * 60;           // 1 Hz
    prevAlt = altFt;
    rows.push([
      date, clock(startLocal + t), clock(startLocal + t - offMin * 60), off,
      lat.toFixed(7), lon.toFixed(7), (altFt + 40 + rnd(8)).toFixed(0),
      Math.max(0, gsKt + (gsKt > 0 ? rnd(0.4) : 0)).toFixed(1),
      vario ? ((vsFpm + rnd(60)) / 196.8504).toFixed(2) : "",
      (altFt + baroErr + rnd(5)).toFixed(0), vario ? (vsFpm + rnd(60)).toFixed(0) : "",
      gsKt > 25 ? (gsKt + 2).toFixed(1) : "0.0", "14.0",
      rpm > 4000 ? "44.5" : "18.0", rpm.toFixed(0), "58.0", "212.0",
      "190.0", "120.0", rpm > 4000 ? "8.5" : "1.2", "43.5",
      "12", "14.1", "1500", "1490", "1510", "1495", "",
    ].join(","));
  };

  let t = 0;
  for (let i = 0; i < idleS; i++, t++) push(t, 0, fieldFt, 1900);        // Warten mit Leerlauf
  for (let i = 0; i < taxiS; i++, t++) push(t, taxiKt, fieldFt, 2500);   // Rollen auf die Piste
  const v0 = taxiS ? taxiKt : 0;
  for (let i = 1; i <= rollS; i++, t++) {                                 // Startlauf
    const v = v0 + (vrKt - v0) * i / rollS;
    push(t, v, fieldFt, 5500, -dipFt * (v / vrKt) ** 2);
  }
  let alt = fieldFt;
  for (let i = 1; i <= climbS; i++, t++) {                                // Steigflug
    alt = fieldFt + 12 * i;
    push(t, vrKt + Math.min(i, 30), alt, 5500);
  }
  for (let i = 0; i < cruiseS; i++, t++) push(t, 100, alt, 5000);        // Reiseflug
  // Sinkflug mit 8 ft/s so, dass die Höhe genau im Aufsetz-Messpunkt die Platzhöhe erreicht
  const descS = Math.ceil((alt - fieldFt) / 8);
  for (let i = descS - 1; i >= 1; i--, t++) push(t, 65, fieldFt + 8 * i, 4000);
  const tdLocal = t;
  push(t++, tdKt, fieldFt, 2000);                                         // Aufsetzen
  for (let v = tdKt - decelKt; v > 0; v -= decelKt, t++) push(t, v, fieldFt, 1900);
  for (let i = 0; i < 20; i++, t++) push(t, 0, fieldFt, 1900);           // Stand, Abstellen

  const info = '#airframe_info,log_version="1.00",product="GDU 460",aircraft_ident="TEST",engine_hours="0.0"';
  return [info, HEADER.join(","), ...rows].join("\r\n") + "\r\n";
}

/** Zeitpunkt (Sekunden ab Log-Beginn) des Aufsetzens im synthetischen Log. */
export function touchdownSecond(o = {}) {
  const idleS = o.idleS ?? 40, taxiS = o.taxiS ?? 0, rollS = o.rollS ?? 18;
  const climbS = o.climbS ?? 120, cruiseS = o.cruiseS ?? 300;
  const descS = Math.ceil((12 * climbS) / 8);
  return idleS + taxiS + rollS + climbS + cruiseS + (descS - 1);
}

/** Analytisch erwartete Startrollstrecke in Metern (mittlere Geschwindigkeit × Zeit). */
export function expectedRollMetres(o = {}) {
  const rollS = o.rollS ?? 18, vrKt = o.vrKt ?? 50;
  const v0 = (o.taxiS ?? 0) ? (o.taxiKt ?? 8) : 0;
  return (v0 + vrKt) / 2 * KT * rollS;
}

/** Analytisch erwartete Landerollstrecke (Aufsetzen bis 10 kt) in Metern. */
export function expectedLandingRollMetres(o = {}) {
  const tdKt = o.tdKt ?? 55, decelKt = o.decelKt ?? 3;
  return ((tdKt * KT) ** 2 - (10 * KT) ** 2) / (2 * decelKt * KT);
}
