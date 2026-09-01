/**
 * The leg engine and the flight altitude schedule - extracted from
 * sections 4b and 4c of the page script (v16.15).
 *
 * VIA-LEG SEMANTICS (v16.4, a settled decision): a leg may carry
 * intermediate "via" points, stored on the DESTINATION waypoint as
 * to.via = [{lat,lng},...], which bend the flown path without creating
 * extra OFP rows. All distance/time/fuel math walks the real bent path
 * segment by segment, while the OFP row's TT/MT/WCA/MH show the DIRECT
 * waypoint-to-waypoint line - the measurement you take off the chart
 * between the named fixes. The per-segment tracks live in the sub-line
 * and the plotting list.
 *
 * THE SCHEDULE (v16.5, a settled decision): legs are NOT independent.
 * computeFlightSchedule does a forward pass, so a climb that does not
 * finish spills onto the leg where the target altitude is actually
 * reached, and a backward pass, so a descent backs up onto earlier legs
 * and every waypoint is crossed AT its planned altitude, never above.
 * Pattern stops break the chain. computeLegTotals WITHOUT a schedule leg
 * keeps the old independent behaviour, which tests and one-off tools
 * rely on.
 *
 * No DOM, no I/O. The aircraft profile is not read off the ambient
 * scope: it comes from performance.js, which the page hands the live
 * object once via setAircraftProfile().
 */
import { calcDistanceNM, calcTrueTrack, interpolateGeo } from './geodesy.js';
import { cruisePerf, climbPerf, climbCumulative, calcWCA, activeAircraftProfile, toRad } from './performance.js';

// 4b. VIA POINTS & UNIFIED LEG ENGINE
//
// A leg may carry intermediate "via" points (stored on the DESTINATION
// waypoint as to.via = [{lat,lng},...]) that bend the flown path without
// creating extra OFP rows. All distance/time/fuel math walks the real
// bent path segment by segment; the OFP shows ONE row per leg with the
// TOTALS, and the detail (climb, descent, via tracks) goes in a compact
// sub-line under the row.
// =========================================================================
/** The points the flown path passes through, from and to included.
 *  @param {Waypoint} from @param {Waypoint} to
 *  @returns {Array<{lat: number, lng: number}>} */
export function legPath(from, to) {
  const pts = [{ lat: from.lat, lng: from.lng }];
  (to.via || []).forEach(v => {
    if (v && isFinite(v.lat) && isFinite(v.lng)) pts.push({ lat: v.lat, lng: v.lng });
  });
  pts.push({ lat: to.lat, lng: to.lng });
  return pts;
}

/** The flown path split into straight spans (one per via point plus one).
 *  @param {Waypoint} from @param {Waypoint} to @returns {PathSegment[]} */
export function pathSegments(from, to) {
  const pts = legPath(from, to);
  const segs = [];
  for (let k = 0; k < pts.length - 1; k++) {
    const d = calcDistanceNM(pts[k].lat, pts[k].lng, pts[k + 1].lat, pts[k + 1].lng);
    if (d < 0.01) continue;
    segs.push({ a: pts[k], b: pts[k + 1], distNM: d,
                tt: calcTrueTrack(pts[k].lat, pts[k].lng, pts[k + 1].lat, pts[k + 1].lng) });
  }
  return segs;
}

// Geographic point (and local track) a given distance along the bent path.
/** @param {PathSegment[]} segs @param {number} dNM distance along the bent path
 *  @returns {PointOnPath} the point AND the local track there */
export function pointAlongSegments(segs, dNM) {
  let acc = 0;
  for (const s of segs) {
    if (dNM <= acc + s.distNM) {
      const within = Math.max(0, dNM - acc);
      const [lat, lng] = interpolateGeo(s.a.lat, s.a.lng, s.b.lat, s.b.lng, within, s.distNM);
      return { lat, lng, tt: s.tt };
    }
    acc += s.distNM;
  }
  const last = segs[segs.length - 1];
  return { lat: last.b.lat, lng: last.b.lng, tt: last.tt };
}

// Perpendicular distance (NM, equirectangular approx - fine at leg scale)
// from a point to a segment, for finding which leg segment was clicked.
/**
 * The full drawn path of a flight: every real waypoint in order, with the via
 * points of the leg ARRIVING at each one placed just before it, so the line
 * follows the bent path rather than the direct one. PATTERN waypoints are not
 * places on the ground and contribute nothing.
 *
 * refreshMap draws from this, and so does every live drag - which is the
 * point. Before v16.27 the drag handler rebuilt the line from waypoints
 * ALONE, so dragging a waypoint on a bent leg made the via points visibly
 * vanish until the drag ended and the map redrew.
 *
 * @param {Flight} fl
 * @returns {[number, number][]} lat/lng pairs, ready for L.polyline
 */
export function flightLineCoords(fl) {
  /** @type {[number, number][]} */
  const out = [];
  const wps = (fl && fl.waypoints) || [];
  wps.forEach((wp, idx) => {
    if (wp.isPattern) return;
    if (idx > 0 && Array.isArray(wp.via)) {
      wp.via.forEach(v => {
        if (v && isFinite(v.lat) && isFinite(v.lng)) out.push([v.lat, v.lng]);
      });
    }
    out.push([wp.lat, wp.lng]);
  });
  return out;
}

/**
 * Which span of which leg a point on the map is nearest to.
 *
 * This is the hit-test behind both "bend the line here" and "insert a
 * waypoint here": the answer identifies the leg (by the index of its END
 * waypoint) and the position WITHIN that leg's via list, counted the way
 * legPath lays the path out - `insertAt` spans are [from, v0, ... vn-1, to],
 * so span k lies between path point k and k+1, and splicing a new via in at
 * index k puts it exactly there.
 *
 * Legs touching a PATTERN waypoint are skipped: a circuit is not a line on
 * the ground and cannot be bent or split.
 *
 * @param {Waypoint[]} waypoints
 * @param {{lat: number, lng: number}} point
 * @returns {{legEnd: number, insertAt: number, distNM: number}|null} null when
 *   the route has no bendable leg at all
 */
export function findPathInsertion(waypoints, point) {
  /** @type {{legEnd: number, insertAt: number, distNM: number}|null} */
  let best = null;
  const wps = waypoints || [];
  for (let i = 0; i < wps.length - 1; i++) {
    const from = wps[i], to = wps[i + 1];
    if (from.isPattern || to.isPattern) continue;
    const pts = legPath(from, to);
    for (let k = 0; k < pts.length - 1; k++) {
      const d = distToSegmentNM(point, pts[k], pts[k + 1]);
      if (!best || d < best.distNM) best = { legEnd: i + 1, insertAt: k, distNM: d };
    }
  }
  return best;
}

/**
 * Where the halfway point of a leg falls, measured along the BENT path rather
 * than the direct line - so on a leg dog-legged around terrain the new point
 * lands on the route actually flown, not out in the middle of the mountain
 * the via points were added to avoid.
 *
 * @param {Waypoint} from @param {Waypoint} to
 * @returns {{lat: number, lng: number}|null} null for a zero-length leg
 */
export function legMidpoint(from, to) {
  const segs = pathSegments(from, to);
  if (!segs.length) return null;
  const total = segs.reduce((a, s) => a + s.distNM, 0);
  const p = pointAlongSegments(segs, total / 2);
  return { lat: p.lat, lng: p.lng };
}

/** Perpendicular distance from a point to a span, for hit-testing a click.
 *  @param {{lat: number, lng: number}} p @param {{lat: number, lng: number}} a
 *  @param {{lat: number, lng: number}} b @returns {number} nautical miles */
export function distToSegmentNM(p, a, b) {
  const kx = 60 * Math.cos(toRad((a.lat + b.lat) / 2));
  const ax = a.lng * kx, ay = a.lat * 60;
  const bx = b.lng * kx, by = b.lat * 60;
  const px = p.lng * kx, py = p.lat * 60;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  const cx = ax + t * dx, cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}


/** Groundspeed and wind correction for one phase of flight.
 *  @param {number} tas knots @param {number} wdir degrees true @param {number} wspd knots
 *  @param {number} tt true track, degrees
 *  @returns {{gs: number, wca: number}} */
export function phaseGS(tas, wdir, wspd, tt) {
  const wAngle = toRad(wdir - tt);
  const wca = calcWCA(tas, wspd, wAngle);
  const gs = tas * Math.cos(toRad(wca)) - wspd * Math.cos(wAngle);
  return { gs: Math.max(1, gs), wca };
}

// ONE leg, fully computed over the bent path: total distance, time and
// burn, with the climb occupying the front of the path and the descent
// the back, each at their own per-segment groundspeeds.
// SL (optional) = this leg's entry in the flight altitude schedule from
// computeFlightSchedule(). With it, climb/descent phases may have been
// carried in from neighbouring legs; without it the leg is computed
// independently exactly as before (kept for tools and tests that look at
// one leg in isolation).
/** Everything the OFP row needs for one leg.
 *  @param {Waypoint} from @param {Waypoint} to
 *  @param {ScheduleLeg|null} [SL] this leg's place in the whole-flight altitude
 *         plan. WITHOUT it the leg is treated as independent, which is the
 *         old behaviour some tests and one-off tools rely on.
 *  @returns {LegResult|null} */
export function computeLegTotals(from, to, SL) {
  if (SL) {
    const cruiseAlt = (SL.tocAlongNM != null || SL.stillClimbing) ? to.alt : SL.entryAlt;
    const crz = cruisePerf(cruiseAlt, Number(to.oat));
    const cruiseDist = Math.max(0, SL.distNM - SL.climbDistNM - SL.descDistNM);
    let acc = 0, cruiseTime = 0;
    for (const s of SL.segs) {
      const midStart = Math.max(acc, SL.climbDistNM);
      const midEnd = Math.min(acc + s.distNM, SL.climbDistNM + cruiseDist);
      if (midEnd - midStart > 0.001)
        cruiseTime += ((midEnd - midStart) / phaseGS(crz.tas, Number(to.wdir), Number(to.wspd), s.tt).gs) * 60;
      acc += s.distNM;
    }
    const timeMin = SL.climbMin + cruiseTime + SL.descMin;
    const burnGal = SL.climbFuelGal + (cruiseTime / 60) * crz.gph + (SL.descMin / 60) * activeAircraftProfile().descFf;
    const parts = [];
    if (SL.climbMin > 0.05) parts.push('CLB');
    if (cruiseTime > 0.5) parts.push('CRZ');
    if (SL.descMin > 0.05) parts.push('DES');
    const profileTag = parts.join('+') || 'CRZ';
    // Displayed TAS: cruise TAS when the leg has a cruise portion (user
    // decision, v16.4); otherwise the dominant phase's TAS.
    let startTas;
    if (cruiseTime > 0.5 || parts.length === 0) startTas = crz.tas;
    else if (SL.climbMin >= SL.descMin) startTas = SL.climbTas || crz.tas;
    else startTas = activeAircraftProfile().descTas;
    const tasCands = [];
    if (SL.climbMin > 0.05) tasCands.push(SL.climbTas || crz.tas);
    if (cruiseTime > 0.5 || parts.length === 0) tasCands.push(crz.tas);
    if (SL.descMin > 0.05) tasCands.push(activeAircraftProfile().descTas);
    const rowTT = Math.round(calcTrueTrack(from.lat, from.lng, to.lat, to.lng));
    const { wca } = phaseGS(startTas, Number(to.wdir), Number(to.wspd), rowTT);
    const effGS = timeMin > 0 ? SL.distNM / (timeMin / 60) : 0;
    const climbInfo = SL.climbMin > 0.05 ? {
      timeMin: SL.climbMin, fuelGal: SL.climbFuelGal,
      tocAlongNM: SL.tocAlongNM != null ? SL.tocAlongNM : SL.climbDistNM,
      completed: SL.tocAlongNM != null,
      carriedIn: SL.entryAlt < from.alt - 1, fromAlt: SL.entryAlt
    } : null;
    const descInfo = SL.descMin > 0.05 ? {
      timeMin: SL.descMin,
      todBeforeNM: SL.todStartsHere ? SL.todBeforeNM : null,
      startsHere: SL.todStartsHere,
      carriedIn: SL.descMin > 0.05 && !SL.todStartsHere,
      continues: SL.descContinues,
      fitsInLeg: SL.todStartsHere && !SL.descContinues,
      targetName: SL.descTargetName, targetAlt: SL.descTargetAlt
    } : null;
    return {
      segs: SL.segs, distNM: SL.distNM, timeMin, burnGal,
      rowTT, rowWCA: Math.round(wca),
      dispTas: Math.round(startTas), minPhaseTas: Math.round(Math.min(...tasCands)),
      effGS: Math.round(effGS), profileTag, climbInfo, descInfo,
      stillClimbing: SL.stillClimbing, entryAlt: Math.round(SL.entryAlt), exitAlt: Math.round(SL.exitAlt),
      shortfall: SL.shortfallMin > 0.001 ? { min: SL.shortfallMin, target: SL.descTargetName, alt: SL.descTargetAlt } : null
    };
  }
  const segs = pathSegments(from, to);
  if (segs.length === 0) return null;
  const totalDist = segs.reduce((a, s) => a + s.distNM, 0);
  const deltaAlt = to.alt - from.alt;

  let timeMin = 0, burnGal = 0;
  let climbInfo = null, descInfo = null;
  let startTas, profileTag, minPhaseTas;

  if (deltaAlt > 0) {
    const cp = climbPerf(from.alt, to.alt, Number(to.oat));
    const crz = cruisePerf(to.alt, Number(to.oat));
    startTas = Math.round(cp.tasAvg);
    let remClimb = cp.timeMin;   // minutes of climb left
    let climbDist = 0;
    for (const s of segs) {
      let segRemain = s.distNM;
      if (remClimb > 0.001) {
        const gsC = phaseGS(cp.tasAvg, Number(to.wdir), Number(to.wspd), s.tt).gs;
        const segClimbCap = gsC * (remClimb / 60);          // NM climbable in this seg
        const climbHere = Math.min(segRemain, segClimbCap);
        const tHere = (climbHere / gsC) * 60;
        timeMin += tHere; remClimb -= tHere;
        climbDist += climbHere; segRemain -= climbHere;
      }
      if (segRemain > 0.001) {
        const gsX = phaseGS(crz.tas, Number(to.wdir), Number(to.wspd), s.tt).gs;
        timeMin += (segRemain / gsX) * 60;
      }
    }
    const completed = remClimb <= 0.05;
    const climbTimeSpent = cp.timeMin - Math.max(0, remClimb);
    const climbFuel = cp.timeMin > 0 ? cp.fuelGal * (climbTimeSpent / cp.timeMin) : 0;
    const cruiseTime = timeMin - climbTimeSpent;
    burnGal = climbFuel + (cruiseTime / 60) * crz.gph;
    climbInfo = { timeMin: climbTimeSpent, fuelGal: climbFuel, tocAlongNM: climbDist, completed };
    profileTag = completed && cruiseTime > 0.5 ? 'CLB+CRZ' : 'CLB';
    // Displayed TAS = the CRUISE TAS when the leg has a cruise portion
    // (user decision, v16.4): time/fuel/GS already account for the slower
    // climb (detailed in the sub-line), so the row's TAS/WCA/MH should
    // describe how the bulk of the leg is flown. An all-climb leg keeps
    // the climb TAS. The integrity check still guards wind against the
    // SLOWEST phase via minPhaseTas.
    if (profileTag === 'CLB+CRZ') startTas = crz.tas;
    minPhaseTas = cp.tasAvg;
  } else if (deltaAlt < 0) {
    const tDesc = Math.abs(deltaAlt) / Math.max(1, activeAircraftProfile().rod);
    const crz = cruisePerf(from.alt, Number(to.oat));
    startTas = crz.tas;
    // Descent occupies the BACK of the path: walk segments in reverse
    // consuming descent time to find its along-path length.
    let remDesc = tDesc, descDist = 0;
    for (let k = segs.length - 1; k >= 0 && remDesc > 0.001; k--) {
      const s = segs[k];
      const gsD = phaseGS(activeAircraftProfile().descTas, Number(to.wdir), Number(to.wspd), s.tt).gs;
      const cap = gsD * (remDesc / 60);
      const here = Math.min(s.distNM, cap);
      remDesc -= (here / gsD) * 60;
      descDist += here;
    }
    const descTimeSpent = tDesc - Math.max(0, remDesc);
    // Now walk forward: cruise until (totalDist - descDist), then descent.
    let acc = 0;
    const todAt = totalDist - descDist;
    for (const s of segs) {
      const cruiseHere = Math.max(0, Math.min(s.distNM, todAt - acc));
      const descHere = s.distNM - cruiseHere;
      if (cruiseHere > 0.001) timeMin += (cruiseHere / phaseGS(crz.tas, Number(to.wdir), Number(to.wspd), s.tt).gs) * 60;
      if (descHere > 0.001) timeMin += (descHere / phaseGS(activeAircraftProfile().descTas, Number(to.wdir), Number(to.wspd), s.tt).gs) * 60;
      acc += s.distNM;
    }
    const cruiseTime = timeMin - descTimeSpent;
    burnGal = (descTimeSpent / 60) * activeAircraftProfile().descFf + (Math.max(0, cruiseTime) / 60) * crz.gph;
    descInfo = { timeMin: descTimeSpent, todBeforeNM: descDist, fitsInLeg: remDesc <= 0.05 };
    profileTag = descDist < totalDist - 0.1 ? 'CRZ+DES' : 'DES';
    if (profileTag === 'DES') startTas = activeAircraftProfile().descTas;
    minPhaseTas = Math.min(crz.tas, activeAircraftProfile().descTas);
  } else {
    const crz = cruisePerf(to.alt, Number(to.oat));
    startTas = crz.tas;
    for (const s of segs) timeMin += (s.distNM / phaseGS(crz.tas, Number(to.wdir), Number(to.wspd), s.tt).gs) * 60;
    burnGal = (timeMin / 60) * crz.gph;
    profileTag = 'CRZ';
    minPhaseTas = crz.tas;
  }

  // The OFP row's TT/MT/WCA/MH describe the DIRECT waypoint-to-waypoint
  // line — the line you measure on the chart between the two named fixes
  // (user decision, v16.4). On a leg with via points the flown tracks
  // differ per segment: those are listed in the ↳ sub-line and in the
  // plotting list. Distance/time/fuel/GS always walk the real bent path.
  const rowTT = Math.round(calcTrueTrack(from.lat, from.lng, to.lat, to.lng));
  const { wca } = phaseGS(startTas, Number(to.wdir), Number(to.wspd), rowTT);
  const effGS = timeMin > 0 ? (totalDist / (timeMin / 60)) : 0;
  return {
    segs, distNM: totalDist, timeMin, burnGal,
    rowTT, rowWCA: Math.round(wca),
    dispTas: Math.round(startTas), minPhaseTas: Math.round(minPhaseTas),
    effGS: Math.round(effGS),
    profileTag, climbInfo, descInfo
  };
}

// Single source of truth for TOC/TOD positions, used by the map, the
// plotting list and the copy-to-clipboard text so they can never disagree.
// TOC is referenced as "distance AFTER the leg's start waypoint";
// TOD as "distance BEFORE the leg's end waypoint" - the way you would
// measure with a ruler from a known fix when marking a VFR chart.
/** @param {Waypoint} from @param {Waypoint} to
 *  @returns {any} the climb/descent breakdown shown under a leg row */
export function computeLegProfile(from, to) {
  if (from.isPattern || to.isPattern) return null;
  const res = computeLegTotals(from, to);
  if (!res) return null;
  if (res.climbInfo && res.climbInfo.completed && res.climbInfo.tocAlongNM < res.distNM - 0.05) {
    const pt = pointAlongSegments(res.segs, res.climbInfo.tocAlongNM);
    return { kind: 'TOC', distNM: res.climbInfo.tocAlongNM, refName: from.name, rel: 'after',
             lat: pt.lat, lng: pt.lng, alt: to.alt, tt: pt.tt };
  }
  if (res.descInfo && res.descInfo.fitsInLeg && res.descInfo.todBeforeNM < res.distNM - 0.05 && res.descInfo.todBeforeNM > 0.05) {
    const pt = pointAlongSegments(res.segs, res.distNM - res.descInfo.todBeforeNM);
    return { kind: 'TOD', distNM: res.descInfo.todBeforeNM, refName: to.name, rel: 'before',
             lat: pt.lat, lng: pt.lng, alt: to.alt, tt: pt.tt };
  }
  return null;
}


// Altitude actually reached after flying `minutesFlown` of a climb from
// fromAlt toward targetAlt. For the POH table the cumulative time column
// is inverted by bisection (the ISA correction scales total time evenly,
// so the time FRACTION maps 1:1 onto the uncorrected table).
/** Altitude actually reached after a partial climb (POH table inverted).
 *  @param {number} fromAlt feet @param {number} targetAlt feet
 *  @param {number} minutesFlown @param {number} [oat] degrees C - missing gives
 *         NaN through climbPerf, which is deliberate (see integrity.js)
 *  @returns {number} feet */
export function climbAltReached(fromAlt, targetAlt, minutesFlown, oat) {
  const cp = climbPerf(fromAlt, targetAlt, Number(oat));
  if (minutesFlown >= cp.timeMin - 0.001) return targetAlt;
  if (minutesFlown <= 0) return fromAlt;
  if (activeAircraftProfile().mode === 'MANUAL')
    return Math.min(targetAlt, fromAlt + activeAircraftProfile().roc * minutesFlown);
  if (activeAircraftProfile().climbMode === 'CRUISECLIMB')
    return Math.min(targetAlt, fromAlt + activeAircraftProfile().ccRoc * minutesFlown);
  const frac = minutesFlown / cp.timeMin;
  const t0 = climbCumulative(fromAlt).t;
  const tGoal = t0 + frac * (climbCumulative(targetAlt).t - t0);
  let lo = fromAlt, hi = targetAlt;
  for (let n = 0; n < 40; n++) {
    const mid = (lo + hi) / 2;
    if (climbCumulative(mid).t < tGoal) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

// Per-flight altitude schedule: an array indexed like the waypoint legs
// (legs[i] = wp[i] -> wp[i+1]; null for pattern pairs).
/** The whole-flight altitude plan: a forward pass so an unfinished climb
 *  spills onto later legs, then a backward pass so a descent starts early
 *  enough that every fix is crossed AT its planned altitude.
 *  @param {Flight} fl
 *  @returns {Array<ScheduleLeg|null>} null where a pattern stop breaks the chain */
export function computeFlightSchedule(fl) {
  const wps = fl.waypoints || [];
  const legs = new Array(Math.max(0, wps.length - 1)).fill(null);

  // ---- forward: entry altitudes and climb placement (climbs may span legs)
  let alt = null;
  for (let i = 0; i < wps.length - 1; i++) {
    const from = wps[i], to = wps[i + 1];
    if (from.isPattern || to.isPattern) continue;
    const segs = pathSegments(from, to);
    if (!segs.length) continue;
    const L = { i, from, to, segs, distNM: segs.reduce((a, s) => a + s.distNM, 0),
                climbMin: 0, climbFuelGal: 0, climbDistNM: 0, climbTas: 0,
                /** @type {number|null} */ tocAlongNM: null, stillClimbing: false,
                descMin: 0, descDistNM: 0, todStartsHere: false, todBeforeNM: null,
                descContinues: false, descTargetName: null, descTargetAlt: null,
                shortfallMin: 0,
                // filled in below; declared here so the shape is complete
                entryAlt: 0, exitAlt: 0 };
    if (alt === null) alt = from.alt;
    L.entryAlt = alt;
    const target = to.alt;
    if (target > alt + 1) {
      const cp = climbPerf(alt, target, Number(to.oat));
      L.climbTas = cp.tasAvg;
      let rem = cp.timeMin, dist = 0;
      for (const s of segs) {
        if (rem <= 0.001) break;
        const gsC = phaseGS(cp.tasAvg, Number(to.wdir), Number(to.wspd), s.tt).gs;
        const here = Math.min(s.distNM, gsC * (rem / 60));
        rem -= (here / gsC) * 60;
        dist += here;
      }
      L.climbMin = cp.timeMin - Math.max(0, rem);
      L.climbFuelGal = cp.timeMin > 0 ? cp.fuelGal * (L.climbMin / cp.timeMin) : 0;
      L.climbDistNM = Math.min(dist, L.distNM);
      if (rem <= 0.05) {
        L.tocAlongNM = L.climbDistNM;
        alt = target;
      } else {
        L.stillClimbing = true;
        alt = climbAltReached(L.entryAlt, target, L.climbMin, Number(to.oat));
      }
    } else {
      alt = target;   // level, or a descent placed by the backward pass
    }
    L.exitAlt = alt;
    legs[i] = L;
  }

  // ---- backward: descent placement (descents may back up across legs)
  for (let i = legs.length - 1; i >= 0; i--) {
    const L = legs[i];
    if (!L) continue;
    const target = L.to.alt;
    const highAlt = L.stillClimbing ? L.exitAlt
                  : (target > L.entryAlt ? target : L.entryAlt);
    if (target >= highAlt - 1) continue;
    let remMin = (highAlt - target) / Math.max(1, activeAircraftProfile().rod);
    for (let k = i; k >= 0 && remMin > 0.001; k--) {
      const Lk = legs[k];
      if (!Lk) break;   // a pattern stop ends the chain
      const availDist = Lk.distNM - Lk.climbDistNM - Lk.descDistNM;
      if (availDist > 0.01) {
        // walk this leg's segments from the END; the very back may
        // already belong to a descent placed for a LATER low waypoint.
        let skip = Lk.descDistNM, usedDist = 0, usedMin = 0;
        for (let s = Lk.segs.length - 1; s >= 0 && remMin > 0.001; s--) {
          const seg = Lk.segs[s];
          let left = seg.distNM;
          if (skip > 0) { const sk = Math.min(skip, left); skip -= sk; left -= sk; }
          if (left <= 0.001) continue;
          left = Math.min(left, availDist - usedDist);
          if (left <= 0.001) break;
          const gsD = phaseGS(activeAircraftProfile().descTas, Number(Lk.to.wdir), Number(Lk.to.wspd), seg.tt).gs;
          const here = Math.min(left, gsD * (remMin / 60));
          const tHere = (here / gsD) * 60;
          usedDist += here; usedMin += tHere; remMin -= tHere;
        }
        Lk.descMin += usedMin;
        Lk.descDistNM += usedDist;
        if (!Lk.descTargetName) { Lk.descTargetName = L.to.name; Lk.descTargetAlt = target; }
        if (remMin <= 0.001) {
          Lk.todStartsHere = true;
          Lk.todBeforeNM = Lk.descDistNM;
          Lk.descTargetName = L.to.name;
          Lk.descTargetAlt = target;
        }
      }
      if (k < i) Lk.descContinues = true;
      // a climb on this leg blocks any earlier descent: TOD can back up
      // at most to just after that climb's TOC.
      if (remMin > 0.001 && (Lk.tocAlongNM != null || Lk.stillClimbing)) break;
    }
    if (remMin > 0.001) L.shortfallMin = remMin;
  }
  return legs;
}

// Map/plotting markers for one leg under the flight schedule: a leg can
// now carry a TOC (possibly from a climb begun legs earlier) AND a TOD
// (possibly for a low waypoint legs later), so this returns a list.
/** TOC/TOD marks to draw on the map and list on the plotting sheet.
 *  @param {Waypoint} from @param {Waypoint} to @param {ScheduleLeg|null} [SL]
 *  @returns {LegMarker[]} a TOD also carries the fix it is descending TO */
export function computeLegMarkers(from, to, SL) {
  if (!SL) { const p = computeLegProfile(from, to); return p ? [p] : []; }
  const out = [];
  if (SL.tocAlongNM != null && SL.tocAlongNM > 0.05 && SL.tocAlongNM < SL.distNM - 0.05) {
    const pt = pointAlongSegments(SL.segs, SL.tocAlongNM);
    out.push({ kind: 'TOC', distNM: SL.tocAlongNM, refName: from.name, rel: 'after',
               lat: pt.lat, lng: pt.lng, alt: to.alt, tt: pt.tt });
  }
  if (SL.todStartsHere && SL.todBeforeNM !== null && SL.todBeforeNM > 0.05 && SL.todBeforeNM < SL.distNM - 0.05) {
    const pt = pointAlongSegments(SL.segs, SL.distNM - SL.todBeforeNM);
    out.push({ kind: 'TOD', distNM: SL.todBeforeNM, refName: to.name, rel: 'before',
               lat: pt.lat, lng: pt.lng, alt: SL.descTargetAlt, tt: pt.tt,
               targetName: SL.descTargetName });
  }
  return out;
}

// =========================================================================
