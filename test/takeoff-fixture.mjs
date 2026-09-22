// Synthetischer G3X-Log mit einem sauberen Start — Grundlage für die Tests der
// Startstrecken-Erkennung. Physik: gleichmäßige Beschleunigung bis Vr, danach
// Steigflug. Die erwarteten Werte sind damit analytisch nachrechenbar.
const KT = 0.514444;

const HEADER = [
  "Date (yyyy-mm-dd)", "Time (hh:mm:ss)", "UTC Time (hh:mm:ss)", "UTC Offset (hh:mm)",
  "Latitude (deg)", "Longitude (deg)", "GPS Altitude (ft)", "GPS Ground Speed (kt)",
  "Baro Altitude (ft)", "Indicated Airspeed (kt)", "Outside Air Temp (deg C)",
  "Manifold Press (inch Hg)", "RPM", "Oil Press (PSI)", "Oil Temp (deg F)",
  "Coolant Temp (deg F)", "Man Temp (deg F)", "Fuel Flow (gal/hour)", "Fuel Press (PSI)",
  "Batt Amps", "Batt Volts", "EGT1 (deg F)", "EGT2 (deg F)", "EGT3 (deg F)", "EGT4 (deg F)",
  "CAS Alert",
];

/**
 * @param {object} o
 * @param {number} o.idleS   Sekunden Stillstand vor dem Losrollen
 * @param {number} o.rollS   Dauer des Startlaufs bis zum Abheben
 * @param {number} o.vrKt    Groundspeed beim Abheben
 * @param {number} o.climbS  Sekunden Steigflug danach
 * @param {number} o.fieldFt Platzhöhe
 * @param {string} o.date    Datum (yyyy-mm-dd)
 * @param {number} o.offMin  Zonenversatz in Minuten (Lokalzeit = UTC + offMin)
 */
export function makeTakeoffCsv(o = {}) {
  const idleS  = o.idleS  ?? 40;
  const rollS  = o.rollS  ?? 18;
  const vrKt   = o.vrKt   ?? 50;
  const climbS = o.climbS ?? 120;
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

  const rows = [];
  const push = (t, gsKt, altFt, rpm) => {
    const lat = 48.1 + t * 1e-4, lon = 14.2 + t * 1e-4;
    rows.push([
      date, clock(startLocal + t), clock(startLocal + t - offMin * 60), off,
      lat.toFixed(7), lon.toFixed(7), (altFt + 40).toFixed(0), gsKt.toFixed(1),
      altFt.toFixed(0), gsKt > 25 ? (gsKt + 2).toFixed(1) : "0.0", "14.0",
      rpm > 4000 ? "44.5" : "18.0", rpm.toFixed(0), "58.0", "212.0",
      "190.0", "120.0", rpm > 4000 ? "8.5" : "1.2", "43.5",
      "12", "14.1", "1500", "1490", "1510", "1495", "",
    ].join(","));
  };

  let t = 0;
  for (let i = 0; i < idleS; i++, t++) push(t, 0, fieldFt, 1900);        // Warten mit Leerlauf
  const a = (vrKt * KT) / rollS;                                          // m/s²
  for (let i = 1; i <= rollS; i++, t++) {                                 // Startlauf
    push(t, (a * i) / KT, fieldFt, 5500);
  }
  for (let i = 1; i <= climbS; i++, t++) {                                // Steigflug
    push(t, vrKt + Math.min(i, 30), fieldFt + 12 * i, 5500);
  }

  const info = '#airframe_info,log_version="1.00",product="GDU 460",aircraft_ident="TEST",engine_hours="0.0"';
  return [info, HEADER.join(","), ...rows].join("\r\n") + "\r\n";
}

/** Analytisch erwartete Startrollstrecke in Metern (0,5·a·t²). */
export function expectedRollMetres(o = {}) {
  const rollS = o.rollS ?? 18, vrKt = o.vrKt ?? 50;
  return 0.5 * ((vrKt * KT) / rollS) * rollS * rollS;
}
