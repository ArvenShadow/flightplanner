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

// How close to a fix a corner has to fall before it IS that fix. It is the
// tolerance the markers have always used to drop a degenerate mark (a climb or
// descent occupying no distance on this leg belongs to the neighbouring one);
// the climb-continuity pass in computeFlightSchedule uses the same number, so
// what the schedule calls one climb and what the map draws as one climb cannot
// disagree. 0.05 NM is 3 seconds at C182 speeds.
const EDGE_NM = 0.05;

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


/**
 * How far along a leg's FLOWN path a clicked point falls, in NM.
 *
 * This is what lets the leg panel pre-fill a pin at the spot the pilot
 * right-clicked: "start the climb HERE" is a gesture, not a number they should
 * have to work out. It walks the bent path, so on a leg dog-legged around
 * terrain the answer is a distance along the route actually flown.
 *
 * The projection onto the nearest segment uses the same local flat metric as
 * distToSegmentNM, which is a UI convenience and is deliberately NOT how any
 * distance on the OFP is computed - those come from the WGS-84 geodesics in
 * geodesy.js. The value is only ever used to seed a pin the pilot then sees
 * and can edit.
 *
 * @param {Waypoint} from @param {Waypoint} to
 * @param {{lat: number, lng: number}} point
 * @returns {{alongNM: number, totalNM: number, offTrackNM: number}|null}
 *          null for a leg with no drawable path
 */
export function alongLegNM(from, to, point) {
  const pts = legPath(from, to);
  if (!pts || pts.length < 2) return null;
  let acc = 0, best = null;
  for (let k = 0; k < pts.length - 1; k++) {
    const a = pts[k], b = pts[k + 1];
    const kx = 60 * Math.cos(toRad((a.lat + b.lat) / 2));
    const ax = a.lng * kx, ay = a.lat * 60;
    const bx = b.lng * kx, by = b.lat * 60;
    const px = point.lng * kx, py = point.lat * 60;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
    const off = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
    const segLen = Math.hypot(dx, dy);
    if (!best || off < best.offTrackNM) best = { alongNM: acc + t * segLen, offTrackNM: off };
    acc += segLen;
  }
  if (!best) return null;
  // Report the total from the SEGMENT lengths the schedule uses, so a pin
  // seeded here cannot exceed the leg the engine will clamp it against.
  const segs = pathSegments(from, to);
  const totalNM = segs.reduce((a, x) => a + x.distNM, 0);
  return {
    alongNM: Math.max(0, Math.min(best.alongNM, totalNM)),
    totalNM,
    offTrackNM: best.offTrackNM
  };
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
    // WHERE EACH PHASE SITS ON THE LEG. Before the pins there was one level
    // stretch and it always followed the climb, so the old arithmetic could
    // assume `[climbDistNM, climbDistNM + cruiseDist]`. A BOC puts level
    // flight BEFORE the climb and a BOD puts it AFTER the descent, so there
    // are now up to three level pieces - and they are not all at the same
    // altitude, which is why each is priced at its own.
    const climbA = SL.climbStartNM, climbB = SL.climbStartNM + SL.climbDistNM;
    const descB = SL.distNM - SL.bodTailNM, descA = descB - SL.descDistNM;
    const wdir = Number(to.wdir), wspd = Number(to.wspd);
    /** Level pieces as [from, to, altitude]: the lead is flown at the altitude
     *  the leg was entered at, the run-in at the altitude it ends at, and the
     *  middle at cruise. */
    const levels = [
      [0, Math.max(0, climbA), SL.entryAlt],
      [climbB, Math.max(climbB, descA), cruiseAlt],
      [Math.max(descB, climbB), SL.distNM, to.alt]
    ];
    let cruiseTime = 0, cruiseGal = 0;
    for (const [a, b, at] of levels) {
      if (b - a <= 0.001) continue;
      const p = at === cruiseAlt ? crz : cruisePerf(at, Number(to.oat));
      const min = phaseMinutes(SL.segs, a, b, p.tas, wdir, wspd);
      cruiseTime += min;
      cruiseGal += (min / 60) * p.gph;
    }
    const timeMin = SL.climbMin + cruiseTime + SL.descMin;
    const burnGal = SL.climbFuelGal + cruiseGal + (SL.descMin / 60) * activeAircraftProfile().descFf;
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
/**
 * Minutes to fly from `startNM` to `endNM` along a leg's segments at a fixed
 * TAS, honouring the wind on each segment.
 *
 * Used for the TOC target's required-rate readout, and by computeLegTotals for
 * the level stretches a pin can create. Kept in one place because "how long is
 * this piece of the leg" is now asked about four different pieces.
 *
 * @param {{distNM: number, tt: number}[]} segs
 * @param {number} startNM @param {number} endNM
 * @param {number} tas @param {number} wdir @param {number} wspd
 * @returns {number} minutes
 */
function phaseMinutes(segs, startNM, endNM, tas, wdir, wspd) {
  let acc = 0, min = 0;
  for (const s of segs) {
    const a = Math.max(acc, startNM), b = Math.min(acc + s.distNM, endNM);
    if (b - a > 0.001) min += ((b - a) / phaseGS(tas, wdir, wspd, s.tt).gs) * 60;
    acc += s.distNM;
  }
  return min;
}

/**
 * Where a climb must START to top out at `tocNM`, given how long it takes.
 *
 * Bisects on the start position because `phaseMinutes` is monotonic in it and
 * already honours the wind on every segment - so this walks the flown path
 * rather than assuming one groundspeed for the leg.
 *
 * @param {{distNM: number, tt: number}[]} segs
 * @param {number} tocNM where the climb must finish, from the leg start
 * @param {number} timeMin how long the climb takes at the profile's rate
 * @param {number} tas @param {number} wdir @param {number} wspd
 * @returns {{startNM: number, shortMin: number}} shortMin > 0 means the climb
 *          does not fit before tocNM even starting at the leg's first fix
 */
export function climbStartForToc(segs, tocNM, timeMin, tas, wdir, wspd) {
  const whole = phaseMinutes(segs, 0, tocNM, tas, wdir, wspd);
  if (whole < timeMin - 0.001) return { startNM: 0, shortMin: timeMin - whole };
  let lo = 0, hi = tocNM;
  for (let n = 0; n < 40; n++) {
    const mid = (lo + hi) / 2;
    if (phaseMinutes(segs, mid, tocNM, tas, wdir, wspd) > timeMin) lo = mid; else hi = mid;
  }
  return { startNM: Number(((lo + hi) / 2).toFixed(4)), shortMin: 0 };
}

/**
 * The LOWEST altitude a leg could start from and still be level at `targetAlt`
 * within `availMin` of climbing.
 *
 * This is what turns "I want to be level by here" into something actionable
 * when the climb does not fit on the leg: rather than inventing a steeper
 * climb, the planner says what altitude the PREVIOUS fix would have to be
 * crossed at. That keeps the altitude column the single source of truth for
 * what is flown where - the pilot raises the fix, and then every leg's numbers
 * and the target agree.
 *
 * Bisected against the real POH climb tables (via climbPerf), so it is exact
 * for the profile in force rather than a constant-rate estimate.
 *
 * BOTH SIDES MOVE WITH THE ANSWER, which is why the time available is a
 * CALLBACK rather than a number. A higher entry altitude shortens the climb
 * (less height to gain) but also raises its TAS, which covers the same
 * distance in LESS time - so comparing a candidate's climb time against a
 * fixed budget computed at the ORIGINAL TAS lands short. Measured: it missed
 * the target by 0.11 NM, which is exactly the kind of quietly-wrong
 * recommendation this project refuses to give.
 *
 * @param {number} targetAlt @param {number} oat
 * @param {number} lowAlt the altitude the leg would otherwise start from
 * @param {(tas: number) => number} timeAvailableAtTas minutes available to
 *        reach the target, for a given climb TAS
 * @returns {number|null} feet, or null when there is no time available at all
 */
export function entryAltForClimbBy(targetAlt, oat, lowAlt, timeAvailableAtTas) {
  const fits = (/** @type {number} */ a) => {
    const cp = climbPerf(a, targetAlt, oat);
    return cp.timeMin <= timeAvailableAtTas(cp.tasAvg);
  };
  if (!(timeAvailableAtTas(climbPerf(lowAlt, targetAlt, oat).tasAvg) > 0.001)) return null;
  if (fits(lowAlt)) return lowAlt;
  let lo = lowAlt, hi = targetAlt;
  for (let n = 0; n < 40; n++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) hi = mid; else lo = mid;
  }
  // ROUNDED UP TO THE NEXT HUNDRED FEET (v16.40, the user's request): a pilot
  // flies and writes whole hundreds, so an OFP crossing altitude should be one.
  //
  // It rounds UP, never to the NEAREST, and that is not a stylistic choice: the
  // figure is a MINIMUM, so the nearest hundred is below it half the time and
  // taking that advice would miss the target it was computed to meet. Rounding
  // down by even half a foot makes the climb marginally too long.
  //
  // The extra height is why a target may now be met EARLY rather than exactly -
  // see the handed-over-climb rule in computeFlightSchedule. Capped at the
  // leg's own target altitude: crossing the previous fix ABOVE the altitude
  // this leg climbs to would make it a descent, not a climb.
  return Math.min(Math.ceil(Math.ceil(hi) / 100) * 100, Math.ceil(targetAlt));
}

/**
 * A leg's climb/descent PINS, and the reason only two of the four corners are
 * pinnable while the other two are checked.
 *
 * v16.5 made legs interdependent: the forward pass places the climb as early
 * as the POH allows and the backward pass places the descent as late as it
 * can, so every waypoint is crossed AT its planned altitude. That derives all
 * four corners - bottom of climb, top of climb, top of descent, bottom of
 * descent - and the pilot could not move any of them.
 *
 * WHAT IS PINNABLE, and why it is exactly these two:
 *
 *   BOC - hold the current altitude for `bocNM` after the leg's start fix,
 *         then climb. A DELAY. It moves the whole climb later and can spill
 *         the TOC onto the next leg, which the forward pass already handles.
 *         Nothing about the aircraft changes, so it is always flyable.
 *
 *   BOD - be level `bodNM` before the leg's end fix, then run in level. Also
 *         pure geometry: the descent simply starts earlier, which the backward
 *         pass already knows how to back up across legs. If there is not room,
 *         that is the existing `shortfallMin`, reported in the red banner.
 *
 * WHAT IS NOT PINNABLE, and this is the NO GUESSTIMATES rule doing real work:
 * "be at 6500 by this point" implies a RATE OF CLIMB. If that rate is higher
 * than the profile's, the POH table this planner is built on says nothing
 * about the fuel flow or the TAS at that rate, and inventing them would put a
 * plausible wrong number on the OFP. So a TOC request is a TARGET, not a pin:
 * the schedule is still flown at the profile's performance, and the leg
 * reports whether the target was met and what rate of climb it would actually
 * need. That is information the pilot can act on; a fabricated climb is not.
 *
 * Distances are along the FLOWN path (via points included), measured the way
 * a pilot would say them: BOC and TOC after the start fix, BOD before the end
 * fix. They live on the leg's TO waypoint, where alt, OAT and wind already do.
 *
 * @param {unknown} v @param {number} maxNM
 * @returns {number} 0 when absent; never negative, never past the leg
 */
function pinNM(v, maxNM) {
  const n = Number(v);
  if (!isFinite(n) || n <= 0) return 0;
  return Math.min(n, Math.max(0, maxNM));
}

/** The whole-flight altitude plan: a forward pass so an unfinished climb
 *  spills onto later legs, then a backward pass so a descent starts early
 *  enough that every fix is crossed AT its planned altitude.
 *  @param {Flight} fl
 *  @param {{verifyAdvice?: boolean}} [opts] internal: verifyAdvice:false stops
 *         the one-level-deep trial that checks a tocNeedsEntryAlt suggestion,
 *         which is the only reason this function ever calls itself.
 *  @returns {Array<ScheduleLeg|null>} null where a pattern stop breaks the chain */
export function computeFlightSchedule(fl, opts) {
  const wps = fl.waypoints || [];
  const legs = new Array(Math.max(0, wps.length - 1)).fill(null);

  // ---- forward: entry altitudes and climb placement (climbs may span legs)
  /** @type {number|null} */
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
                // PINS (v16.37). climbStartNM is the BOC - how far the current
                // altitude is held before the climb begins. bodTailNM is the
                // BOD - how far before the end fix the descent must finish, so
                // the last stretch is flown level. Both default to 0, which is
                // exactly the derived v16.5 behaviour.
                climbStartNM: 0, bodPinNM: 0, bodTailNM: 0, bodRefused: false,
                /** @type {number|null} */ tocTargetNM: null,
                tocTargetMet: true,
                /** @type {number|null} */ climbRateReqFpm: null,
                // Set when a TOC target placed the BOC rather than the pilot.
                tocDerivedBoc: false,
                /** What the leg's START fix would have to be crossed at for the
                 *  target to be reachable at the profile's climb rate. Null on
                 *  the first leg, where there is no earlier fix to raise. */
                /** @type {number|null} */ tocNeedsEntryAlt: null,
                tocNoAltHelps: false,
                // This leg's climb is handed over from the previous leg, which
                // topped out on the shared fix: it starts AT the fix and cannot
                // be delayed, so a "be level by" target here is a deadline to
                // check rather than a position to set.
                tocContinuation: false,
                /** Where the earlier leg's "be level by" pin would go, and where
                 *  its climb would then begin - both read from the trial that
                 *  VERIFIED the advice, so the sentence offering it cannot
                 *  describe something other than what applying it does. */
                /** @type {number|null} */ tocAdviceLevelByNM: null,
                /** @type {number|null} */ tocAdviceClimbFromNM: null,
                // This leg's climb tops out ON its end fix and the next leg
                // climbs straight on from there: ONE climb through the fix, so
                // this leg has no top of climb to draw. See the pass below.
                climbContinues: false,
                // filled in below; declared here so the shape is complete
                entryAlt: 0, exitAlt: 0 };
    if (alt === null) alt = from.alt;
    L.entryAlt = alt;
    // THE REQUEST, not yet the effective tail. A BOD pin is a statement about
    // the descent that TERMINATES at this leg's end fix, and only the backward
    // pass knows whether such a descent exists here and whether the tail is
    // still free - so bodTailNM stays 0 until it decides.
    L.bodPinNM = pinNM(to.bodNM, L.distNM);
    const target = to.alt;
    if (target > alt + 1) {
      const cp = climbPerf(alt, target, Number(to.oat));
      L.climbTas = cp.tasAvg;
      const wdirC = Number(to.wdir), wspdC = Number(to.wspd);

      // A "BE LEVEL BY HERE" TARGET SETS THE BOTTOM OF CLIMB (v16.38).
      //
      // The pilot names the corner they care about - where they want to be
      // level - and the planner works backwards at the PROFILE'S OWN climb
      // rate to find where the climb has to begin. Nothing about the aircraft
      // is invented: the rate, the fuel flow and the TAS are the POH's, and
      // only the climb's POSITION moves. It is the same kind of pin as a BOC,
      // just stated from the other end, and it is what a BOC pin becomes.
      const tocT = pinNM(to.tocNM, L.distNM);
      // IT DOES NOT FIT / IT OVERSHOT. Either way the honest answer is not a
      // steeper climb - the POH says nothing about that - it is the altitude
      // this leg would have to START from. The pilot raises the previous fix
      // and then the altitude column, every leg's numbers and the target all
      // agree. On the FIRST leg there is no earlier fix to raise (you cannot
      // climb before takeoff), so only the required rate can be reported.
      const missTarget = () => {
        const availMin = phaseMinutes(segs, 0, tocT, cp.tasAvg, wdirC, wspdC);
        L.tocTargetMet = false;
        L.climbRateReqFpm = availMin > 0.001 ? Math.round((target - L.entryAlt) / availMin) : null;
        L.tocNeedsEntryAlt = i > 0
          ? entryAltForClimbBy(target, Number(to.oat), L.entryAlt,
              (tas) => phaseMinutes(segs, 0, tocT, tas, wdirC, wspdC))
          : null;
      };
      if (tocT > 0) {
        L.tocTargetNM = tocT;
        L.tocDerivedBoc = true;
        // A CLIMB HANDED OVER FROM THE PREVIOUS LEG CANNOT BE DELAYED (v16.40).
        //
        // When the leg before tops out exactly ON the shared fix and this leg
        // climbs on, the two are ONE climb through the fix: there is no level
        // flight at the fix to postpone. The target is then a DEADLINE to check
        // rather than a position to set, and topping out EARLY is never a
        // problem. This is what lets the "cross this fix at" advice round to a
        // whole hundred feet: the rounding buys a little height, so the climb
        // finishes a little sooner than asked and stays continuous, instead of
        // levelling off for seven seconds at the fix just to restart.
        const prevL = legs[i - 1];
        const handedOver = !!prevL && prevL.climbDistNM > EDGE_NM && prevL.tocAlongNM !== null
          && prevL.distNM - prevL.tocAlongNM <= EDGE_NM;
        L.tocContinuation = handedOver;
        if (handedOver) {
          L.climbStartNM = 0;   // checked against the target after the walk
        } else {
          const back = climbStartForToc(segs, tocT, cp.timeMin, cp.tasAvg, wdirC, wspdC);
          L.climbStartNM = back.startNM;
          if (back.shortMin > 0.001) missTarget();
        }
      } else {
        L.climbStartNM = pinNM(to.bocNM, L.distNM);
      }
      // The climb begins at the BOC, so the first climbStartNM of the leg is
      // skipped. With no pin that is 0 and this is the v16.5 walk exactly.
      let rem = cp.timeMin, dist = 0, skip = L.climbStartNM;
      for (const s of segs) {
        let left = s.distNM;
        if (skip > 0) { const sk = Math.min(skip, left); skip -= sk; left -= sk; }
        if (left <= 0.001) continue;
        if (rem <= 0.001) break;
        const gsC = phaseGS(cp.tasAvg, Number(to.wdir), Number(to.wspd), s.tt).gs;
        const here = Math.min(left, gsC * (rem / 60));
        rem -= (here / gsC) * 60;
        dist += here;
      }
      L.climbMin = cp.timeMin - Math.max(0, rem);
      L.climbFuelGal = cp.timeMin > 0 ? cp.fuelGal * (L.climbMin / cp.timeMin) : 0;
      L.climbDistNM = Math.min(dist, Math.max(0, L.distNM - L.climbStartNM));
      if (rem <= 0.05) {
        L.tocAlongNM = L.climbStartNM + L.climbDistNM;
        alt = target;
      } else {
        L.stillClimbing = true;
        alt = climbAltReached(L.entryAlt, target, L.climbMin, Number(to.oat));
      }
      // A climb that does not finish on this leg cannot have met a target on it.
      if (L.tocTargetNM != null && L.tocAlongNM == null) L.tocTargetMet = false;
      // A handed-over climb was not positioned, so its target is checked here:
      // it is met when the climb tops out AT OR BEFORE the deadline.
      if (L.tocContinuation && L.tocTargetMet
          && (L.tocAlongNM === null || L.tocAlongNM > tocT + EDGE_NM)) missTarget();
    } else {
      // No climb on this leg, so no BOC to place - and climbStartNM MUST stay
      // 0, or the backward pass would treat the first stretch as blocked and
      // refuse to put a descent there.
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
    // THE BOD PIN, resolved here because this is where a descent is known to
    // terminate at L.to. If a descent for a LATER, lower fix has already
    // claimed the tail of this leg, the aircraft is still going down through
    // it and "be level X NM before this fix" cannot be true - so the pin is
    // REFUSED and reported rather than half-applied.
    let bodTail = 0;
    if (L.bodPinNM > 0) {
      if (L.descDistNM > 0.001) L.bodRefused = true;
      else { bodTail = L.bodPinNM; L.bodTailNM = bodTail; }
    }
    let remMin = (highAlt - target) / Math.max(1, activeAircraftProfile().rod);
    for (let k = i; k >= 0 && remMin > 0.001; k--) {
      const Lk = legs[k];
      if (!Lk) break;   // a pattern stop ends the chain
      // The climb blocks everything up to its TOC, not just its own length:
      // with a BOC the climb no longer starts at the leg's beginning.
      // The BOD tail is level flight and belongs to no phase, so it is
      // unavailable to the descent as well - but only on the leg whose end
      // fix terminates this descent, which is leg i.
      const tail = k === i ? bodTail : 0;
      const availDist = Lk.distNM - (Lk.climbStartNM + Lk.climbDistNM) - Lk.descDistNM - tail;
      if (availDist > 0.01) {
        // walk this leg's segments from the END; the very back may
        // already belong to a descent placed for a LATER low waypoint, or to
        // the level run-in a BOD pin asked for.
        let skip = tail + Lk.descDistNM, usedDist = 0, usedMin = 0;
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
          // Distance before the leg's END fix. The level run-in a BOD pin adds
          // sits between the descent and the fix, so it counts too.
          Lk.todBeforeNM = tail + Lk.descDistNM;
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

  // WHERE THE DESCENT ACTUALLY STARTS, settled after ALL of it is placed.
  //
  // todBeforeNM used to be latched during the walk, at the moment a descent
  // finished backing up. That is too early: a SECOND descent - for a later,
  // lower fix - can be placed on the same leg afterwards and extend further
  // back, and the latched value then pointed at where the aircraft was already
  // descending rather than where it starts down. The descent's start is simply
  // where its distance ends up reaching, so it is computed once, here.
  //
  // A BOD pin is what made this reachable in practice (it pushes a descent
  // back onto the previous leg), but the flaw was latent: the right altitudes
  // alone could always have produced two descents on one leg.
  for (const L of legs) {
    if (L && L.todStartsHere) L.todBeforeNM = L.bodTailNM + L.descDistNM;
  }

  // ONE CLIMB THROUGH A FIX IS ONE CLIMB (v16.39).
  //
  // When a leg's climb tops out exactly ON its end fix and the next leg climbs
  // straight on from that same fix, the aircraft never levels off: it is a
  // single continuous climb that happens to cross a waypoint. The earlier leg
  // therefore has no top of climb to draw, and saying it does puts TWO "TOC"
  // marks on the map for one climb - the first of them at a point the aircraft
  // flies straight through.
  //
  // This is a property of the SCHEDULE, not of how it was built, so it holds
  // whether the corners were pinned, suggested by the "cross this fix at" advice
  // or fell out of the altitudes on their own.
  for (let k = 0; k + 1 < legs.length; k++) {
    const L = legs[k], N = legs[k + 1];
    if (!L || !N || L.tocAlongNM === null) continue;
    if (L.distNM - L.tocAlongNM > EDGE_NM) continue;   // tops out on the end fix
    if (N.climbStartNM > EDGE_NM) continue;            // and climbs on from it
    // ...AND SOMEBODY ELSE DRAWS THAT CLIMB'S TOP. The test is who draws the
    // mark, not how long the next climb is: a next-leg climb of 0.0499 NM is
    // degenerate by length yet its TOC lands at 0.0500 NM and IS drawn, so
    // testing the length suppressed nothing and put two marks a twentieth of a
    // mile apart. If the next leg draws no top of climb - it does not climb at
    // all, or its climb is too short to mark - then this leg's top IS the top
    // and it stays.
    if (!((N.tocAlongNM !== null && N.tocAlongNM > EDGE_NM) || N.stillClimbing)) continue;
    L.climbContinues = true;
  }

  // ADVICE IS ONLY OFFERED IF IT ACTUALLY WORKS.
  //
  // "Cross the previous fix at 4122 ft and the target fits" is computed from
  // THIS leg alone, but raising that fix also changes the leg BEFORE it - and
  // if those earlier legs cannot climb that high by then, the aircraft arrives
  // lower than the raised figure and the target is missed all over again.
  // Measured over 20 000 generated routes: the per-leg figure alone was wrong
  // 382 times in 947. So each candidate is TRIED on a copy of the flight and
  // dropped unless the target is really met.
  //
  // A failed candidate means no altitude at that fix helps: a higher one is
  // strictly harder for the earlier legs to reach, so verifying once is enough
  // and there is nothing to search.
  //
  // THE TRIAL RAISES THE FIX **AND** DELAYS THE EARLIER CLIMB (v16.39), because
  // that is what taking the advice does. Raising the fix alone tops the earlier
  // leg out early and holds the new altitude to the fix, so the pilot gets two
  // climbs with a level stretch between them instead of the one continuous
  // climb they asked for. A "be level by" pin at the earlier leg's FULL length
  // says "top out on that fix", which is the same climb - same minutes, same
  // fuel - moved to the end of the leg, where it runs straight on into this
  // leg's climb. Both legs' targets must then be met, or the advice is not
  // offered: the earlier leg has a target of its own now.
  if (!opts || opts.verifyAdvice !== false) {
    for (const L of legs) {
      if (!L || L.tocNeedsEntryAlt === null) continue;
      const prev = legs[L.i - 1] || null;
      const levelBy = prev ? prev.distNM : 0;
      const trial = Object.assign({}, fl, {
        waypoints: wps.map((w, k) => k === L.i
          ? Object.assign({}, w, { alt: L.tocNeedsEntryAlt, tocNM: levelBy || w.tocNM })
          : Object.assign({}, w))
      });
      const T = computeFlightSchedule(trial, { verifyAdvice: false });
      const check = T[L.i], earlier = prev ? T[L.i - 1] : null;
      if (!check || !check.tocTargetMet || (prev && (!earlier || !earlier.tocTargetMet))) {
        L.tocNeedsEntryAlt = null;
        L.tocNoAltHelps = true;
      } else if (earlier && earlier.climbDistNM > EDGE_NM) {
        // Only when there IS an earlier climb to delay. Where the aircraft
        // DESCENDS into the raised fix (40 of 305 swept routes) the climb
        // genuinely begins at the fix, nothing is split, and pinning "be level
        // by" on a leg with no climb would write route data that does nothing.
        L.tocAdviceLevelByNM = levelBy;
        L.tocAdviceClimbFromNM = earlier.climbStartNM;
      }
    }
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
  // A marker sitting ON a waypoint is still real information, and dropping it
  // is the v16.27 bug: when a descent filled a whole leg, the TOD landed
  // within a few hundredths of a mile of the leg's START and the old guard
  // (`< distNM - 0.05`) threw it away - so the pilot saw the descent begin
  // with no TOD anywhere on the map. It is now KEPT and flagged `atWaypoint`,
  // because "start down at B" is what that case actually means. The remaining
  // guard is only against a degenerate marker: a climb or descent that
  // occupies no distance on THIS leg belongs to the neighbouring one, which
  // draws it.
  if (SL.tocAlongNM != null && SL.tocAlongNM > EDGE_NM && !SL.climbContinues) {
    const along = Math.min(SL.tocAlongNM, SL.distNM);
    const pt = pointAlongSegments(SL.segs, along);
    out.push({ kind: 'TOC', distNM: SL.tocAlongNM, refName: from.name, rel: 'after',
               lat: pt.lat, lng: pt.lng, alt: to.alt, tt: pt.tt,
               atWaypoint: SL.distNM - SL.tocAlongNM <= EDGE_NM ? to.name : null });
  }
  if (SL.todStartsHere && SL.todBeforeNM !== null && SL.todBeforeNM > EDGE_NM) {
    const along = Math.max(0, SL.distNM - SL.todBeforeNM);
    const pt = pointAlongSegments(SL.segs, along);
    out.push({ kind: 'TOD', distNM: SL.todBeforeNM, refName: to.name, rel: 'before',
               lat: pt.lat, lng: pt.lng, alt: SL.descTargetAlt, tt: pt.tt,
               targetName: SL.descTargetName,
               atWaypoint: along <= EDGE_NM ? from.name : null });
  }
  // THE PINNED CORNERS ARE DRAWN ONLY WHEN THEY WERE PINNED. With no pin the
  // bottom of a climb IS the start fix and the bottom of a descent IS the end
  // fix, and marking a point that is already a named waypoint adds nothing but
  // clutter - the same reason a degenerate TOC is left to the neighbouring leg.
  if (SL.climbStartNM > EDGE_NM && SL.climbDistNM > EDGE_NM) {
    const pt = pointAlongSegments(SL.segs, SL.climbStartNM);
    out.push({ kind: 'BOC', distNM: SL.climbStartNM, refName: from.name, rel: 'after',
               lat: pt.lat, lng: pt.lng, alt: SL.entryAlt, tt: pt.tt, atWaypoint: null });
  }
  if (SL.bodTailNM > EDGE_NM && SL.descDistNM > EDGE_NM) {
    const pt = pointAlongSegments(SL.segs, Math.max(0, SL.distNM - SL.bodTailNM));
    out.push({ kind: 'BOD', distNM: SL.bodTailNM, refName: to.name, rel: 'before',
               lat: pt.lat, lng: pt.lng, alt: to.alt, tt: pt.tt, atWaypoint: null });
  }
  // IN FLIGHT ORDER, not the order they happened to be built in. The plotting
  // list and the OFP sub-line both print this straight through, and a pilot
  // reading "TOC ... BOC" down a leg they fly BOC-first has to reorder it in
  // their head. `rel` says which end each distance is measured from.
  out.sort((a, b) => (a.rel === 'after' ? a.distNM : SL.distNM - a.distNM)
                   - (b.rel === 'after' ? b.distNM : SL.distNM - b.distNM));
  return out;
}

// =========================================================================
