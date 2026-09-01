/**
 * The chart plotting list - extracted from section 7c (v16.19).
 *
 * This is the text the pilot COPIES onto the paper OFP, so it is content,
 * not decoration, and it is pure: give it a flight and a distance unit and
 * it returns the string. The <details> element that displays it, and the
 * clipboard button, stay in the page with the rest of the UI.
 *
 * Per the v16.4 decision the legs here are the WHOLE-LEG lines as drawn on
 * the chart, walking each via segment - these are the tracks you actually
 * steer, as opposed to the OFP row, which shows the direct
 * waypoint-to-waypoint line you measured between the named fixes.
 */
import { toDMM, convertDist, distLabel } from './format.js';
import { computeFlightSchedule, computeLegTotals, computeLegMarkers } from './legs.js';
import { flightTitle } from './integrity.js';

export function buildPlottingText(fl, distUnit) {
  distUnit = distUnit || 'NM';
  const lines = [];
  lines.push(`${flightTitle(fl).toUpperCase()} - WAYPOINTS`);
  fl.waypoints.forEach((wp, i) => {
    const tag = wp.isPattern ? ` (PATTERN x${wp.laps})` : '';
    lines.push(`${String(i + 1).padEnd(3)} ${(wp.name + tag).padEnd(18)} ${toDMM(wp.lat, true)}  ${toDMM(wp.lng, false)}  ${wp.alt}'`);
  });
  lines.push('');
  lines.push(`LEGS (whole-leg, as drawn on chart)`);
  const schedT = computeFlightSchedule(fl);
  for (let i = 0; i < fl.waypoints.length - 1; i++) {
    const from = fl.waypoints[i], to = fl.waypoints[i + 1];
    if (from.isPattern || to.isPattern) continue;
    const res = computeLegTotals(from, to, schedT[i]);
    if (!res) continue;
    const profs = computeLegMarkers(from, to, schedT[i]);
    let acc = 0;
    res.segs.forEach((sg, k) => {
      const nameA = k === 0 ? from.name : 'v' + k;
      const nameB = k === res.segs.length - 1 ? to.name : 'v' + (k + 1);
      const smt = Math.round((sg.tt + to.var + 360) % 360);
      const profTxt = profs
        .filter(p => { const along = p.kind === 'TOC' ? p.distNM : res.distNM - p.distNM;
                       return along > acc - 0.001 && along <= acc + sg.distNM + 0.001; })
        .map(p => `  | ${p.kind} ${convertDist(p.distNM, distUnit).toFixed(1)} ${distLabel(distUnit)} ${p.rel} ${p.refName}`)
        .join('');
      lines.push(`${(nameA + ' - ' + nameB).padEnd(28)} TT ${String(sg.tt).padStart(3, '0')}  MT ${String(smt).padStart(3, '0')}  ${convertDist(sg.distNM, distUnit).toFixed(1).padStart(5)} ${distLabel(distUnit)}${profTxt}`);
      acc += sg.distNM;
    });
  }
  return lines.join('\n');
}
