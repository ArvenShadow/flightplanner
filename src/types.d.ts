/**
 * The domain, written down once.
 *
 * These are the things the planner actually reasons about: a waypoint, a
 * flight, what a leg works out to, what a schedule does to it. Every module
 * refers to these names, so a change to the shape of a waypoint is caught
 * everywhere it is used instead of in whichever screen happens to be open.
 *
 * This file declares types only. Nothing here exists at runtime - it is
 * erased before anything runs, and the modules stay plain JavaScript.
 *
 * Units are part of the type's meaning and are stated on every field.
 * Everything is COMPUTED in nautical miles, US gallons, knots and feet -
 * the POH's units - and converted only for display.
 */

/** A point in a route: a fix, an aerodrome, or a traffic-circuit stop. */
interface Waypoint {
  /** Name as it appears on the chart and the OFP, e.g. "ENDU". */
  name: string;
  /** Degrees, WGS-84. */
  lat: number;
  /** Degrees, WGS-84. */
  lng: number;
  /** Planned altitude AT this point, feet AMSL. */
  alt: number;
  /** Outside air temperature for the leg ENDING here, degrees C. */
  oat?: number;
  /** Wind direction for the leg ENDING here, degrees TRUE. */
  wdir?: number;
  /** Wind speed for the leg ENDING here, knots. */
  wspd?: number;
  /**
   * Magnetic variation in the OFP's sign convention: WEST positive, so
   * MH = TT + var. Null means "not resolved yet".
   */
  var?: number | null;
  /** Where the value in `var` came from. MANUAL is never overwritten by a
   *  refresh - a figure the pilot typed is theirs. */
  varSource?: 'WMM2025' | 'MANUAL';
  /** True when this is a traffic-circuit stop rather than a leg endpoint:
   *  it costs time and fuel but no distance, and it breaks the climb and
   *  descent chain either side of it. */
  isPattern?: boolean;
  /** Number of circuits flown at a pattern stop. */
  laps?: number;
  /** Intermediate points that BEND the path to this waypoint without
   *  creating an OFP row. Distance, time and fuel walk the bent path; the
   *  row still shows the direct chart track between the named fixes. */
  via?: Array<{ lat: number; lng: number }>;
}

/** One sector: a takeoff, some waypoints, a landing. */
interface Flight {
  id: number;
  /** Fallback label. The displayed name is derived from the first and last
   *  waypoint (see flightTitle), e.g. "ENDU-ENTC". */
  title: string;
  /** Departure elevation, feet AMSL. */
  depElev: number;
  waypoints: Waypoint[];
}

/** One straight piece of a leg: a whole leg, or one span between via points. */
interface PathSegment {
  a: { lat: number; lng: number };
  b: { lat: number; lng: number };
  /** Nautical miles. */
  distNM: number;
  /** True track, whole degrees. */
  tt: number;
}

/** What a leg works out to once wind, climb and descent are accounted for. */
interface LegResult {
  segs: PathSegment[];
  /** Total along the FLOWN path, nautical miles. */
  distNM: number;
  /** Unrounded; the displayed whole minutes are rounded from this. */
  timeMin: number;
  /** US gallons. */
  burnGal: number;
  /** The track shown on the OFP row: the DIRECT line between the named
   *  fixes, which is what you measure on the chart (v16.4 decision). */
  rowTT: number;
  /** Wind correction angle for the row, degrees. */
  rowWCA: number;
  /** The TAS shown on the row - cruise TAS even on a climbing leg, because
   *  that is the number the pilot flies; time and fuel still account for
   *  the climb. */
  dispTas: number;
  /** TAS of the slowest phase on this leg. Wind at or above this makes
   *  groundspeed, time and fuel meaningless, and the integrity check says so. */
  minPhaseTas: number;
  /** Whole-leg effective groundspeed, knots. */
  effGS: number;
  /** CLB, CRZ, DES, CLB+CRZ ... */
  profileTag?: string;
  /** Set when the descent cannot be flown even starting on earlier legs.
   *  target/alt can be null when the schedule could not name the fix. */
  shortfall?: { alt: number | null; target: string | null; min: number } | null;
  /** True when the target altitude is not reached by the end of this leg. */
  stillClimbing?: boolean;
  /** Altitude at the start of the leg, feet. */
  entryAlt?: number;
  /** Altitude actually reached at the end of the leg, feet. */
  exitAlt?: number;
  /** The climb portion, for the sub-line under the row. */
  climbInfo?: any;
  /** The descent portion, for the sub-line under the row. */
  descInfo?: any;
}

/** A point on the flown path, carrying the local track there. */
interface PointOnPath {
  lat: number;
  lng: number;
  /** True track of the span this point falls on, degrees. */
  tt: number;
}

/**
 * A leg's place in the whole-flight altitude plan. Legs are NOT independent:
 * a climb that does not finish spills onto the next leg, and a descent backs
 * up onto earlier ones so a fix is crossed AT its planned altitude, never
 * above it (v16.5 decision). Null means the chain is broken there - a
 * pattern stop.
 */
interface ScheduleLeg {
  i: number;
  from: Waypoint;
  to: Waypoint;
  segs: PathSegment[];
  distNM: number;
  climbMin: number;
  climbFuelGal: number;
  climbDistNM: number;
  climbTas: number;
  /** Distance from the leg start at which the climb tops out. */
  tocAlongNM: number | null;
  /** True when the target altitude is still not reached at the leg end. */
  stillClimbing: boolean;
  descMin: number;
  descDistNM: number;
  /** True when the top of descent falls on THIS leg. */
  todStartsHere: boolean;
  /** How far before the leg end the descent begins, nautical miles. */
  todBeforeNM: number | null;
  /** True when a descent that began earlier is still running through here. */
  descContinues: boolean;
  descTargetName: string | null;
  descTargetAlt: number | null;
  /** Minutes by which an impossible descent falls short. 0 when achievable. */
  shortfallMin: number;
  /** Altitude at the start of the leg, feet. */
  entryAlt: number;
  /** Altitude at the end of the leg, feet. */
  exitAlt: number;
}

/** A published vertical limit, kept as its three source fields. GND/UNL are
 *  codes and a flight level is not an altitude AMSL, so `ft` is filled in
 *  only for a published measured altitude. */
interface AirspaceLimit {
  text: string;
  ft: number | null;
  datum: string | null;
  kind: string;
}

/** One drawable airspace volume from the Avinor eAIP. */
interface AirspaceFeature {
  name: string;
  kind: string;
  /** Published ICAO class, or null when the source does not state one. */
  class: string | null;
  lower: AirspaceLimit;
  upper: AirspaceLimit;
  /** Outer ring, [lat, lng] pairs, not closed. */
  ring: [number, number][];
  /** How many stretches of the boundary came from Kartverket's border. */
  borderSegments: number;
  /** Largest distance a published corner sat from the surveyed border, NM. */
  borderMaxSnapNM: number;
  /** ATS services, each with the frequencies published for it. This is the
   *  only frequency store - there is no flat copy. */
  services: {
    /** APP / TWR / ATIS / AFIS / ACC / RADIO / TFC, or null when neither the
     *  source nor the callsign states one. */
    code: string | null;
    callsign: string | null;
    freqs: { mhz: string, unit: string, remarks: string }[];
  }[];
  /** ICAO of the AD 2 page this came from; null for ENR 2.1 airspace. */
  icao: string | null;
  source: { section: string, url: string };
  /** Cached bounding box (airspaceBounds); not part of the dataset. */
  _bbox?: { south: number, west: number, north: number, east: number };
}

/**
 * A Polaris (or other ACC) sector: its published lateral boundary, band and
 * the ONE frequency published for it in AIP ENR 2.2.
 *
 * Sectors are NOT drawn on the map - an en-route sector division far above a
 * C182 would bury the CTRs and TMAs that matter. They exist so the hover card
 * can name the sector working the piece of sky under the cursor instead of
 * reciting every Polaris frequency in the country.
 */
interface AirspaceSector {
  name: string;
  lower: AirspaceLimit;
  upper: AirspaceLimit;
  callsign: string | null;
  mhz: string;
  /** The published frequency remark, verbatim. */
  remark: string;
  /** Designator tokens the remark claims, e.g. ["9", "12"] for "Sector 9/12" -
   *  ONE frequency really does serve two combined sectors. */
  designators: string[];
  /** Operational free text after the designator phrase, or null. */
  note: string | null;
  ring: [number, number][];
  borderSegments: number;
}

/** A TOC or TOD mark to draw on the map and list on the plotting sheet. */
interface LegMarker {
  kind: string;
  /** Distance from the reference point, nautical miles. */
  distNM: number;
  /** 'after' or 'before'. */
  rel: string;
  /** The fix the distance is measured from. */
  refName: string;
  lat?: number;
  lng?: number;
  /** Altitude the mark sits at, feet. Null when the schedule could not
   *  establish the descent target. */
  alt?: number | null;
  /** Local true track where the mark falls, degrees. */
  tt?: number;
  /** TOD only: the fix being descended to. */
  targetName?: string | null;
  /** Set when the mark falls ON a waypoint rather than part-way along a leg -
   *  a descent that fills a whole leg starts AT the previous fix. Names that
   *  fix, so the label can say "at B" instead of "27.1 NM before ENTC". */
  atWaypoint?: string | null;
}

/**
 * Aircraft and display settings. The page owns this object; performance.js
 * is handed it once by reference (setAircraftProfile) rather than reading it
 * off the ambient scope.
 *
 * Only the keys in exchange.js's PROFILE_KEYS may cross an export or import
 * boundary. Do not put anything here that identifies a person, a machine or
 * a place.
 */
interface AircraftProfile {
  /** C182T uses the POH tables; MANUAL uses the pilot's own figures. */
  mode: 'C182T' | 'MANUAL';
  cruiseRpm: number;
  cruiseMp: number;
  /** MANUAL mode only, knots. */
  cruiseTas: number;
  /** MANUAL mode only, gallons per hour. */
  cruiseFf: number;
  /** POH = Fig 5-8 full throttle; CRUISECLIMB = the pilot's observed figures. */
  climbMode: 'POH' | 'CRUISECLIMB';
  ccRoc: number;
  ccKias: number;
  ccFf: number;
  roc: number;
  climbTas: number;
  climbFf: number;
  rod: number;
  descTas: number;
  descFf: number;
  patternTime: number;
  patternFf: number;
  taxiFuel: number;
  theme?: 'light' | 'dark';
  distUnit?: 'NM' | 'SM' | 'KM';
  fuelUnit?: 'GAL' | 'LITERS' | 'KG';
  minuteMark?: number;
  declutter?: string;
  baseChart?: 'topo' | 'vfr';
  /** How dense a chart raster to request. 'auto' keeps full detail at the
   *  zooms the chart is read at and lightens the overview, where decoding a
   *  dense tile costs about a second per screen. */
  chartDetail?: 'auto' | 'sharp' | 'fast';
}

/**
 * Exactly the profile fields the CALCULATION engines read - performance.js
 * and, through activeAircraftProfile(), legs.js. Naming the subset rather
 * than passing the whole profile documents the real dependency: a change to
 * themes, units, taxi fuel or pattern time cannot break a fuel figure,
 * because the engines never see them.
 */
type EngineProfile = Pick<AircraftProfile,
  'mode' | 'cruiseRpm' | 'cruiseMp' | 'cruiseTas' | 'cruiseFf' |
  'climbMode' | 'ccRoc' | 'ccKias' | 'ccFf' | 'roc' | 'climbTas' | 'climbFf' |
  'rod' | 'descTas' | 'descFf'>;

/**
 * Sun times for one date and place, in UTC milliseconds.
 *
 * The day-VFR boundary is CIVIL TWILIGHT, not sunset: SERA Art. 2(97) puts
 * night between the end of evening civil twilight and the beginning of
 * morning civil twilight, sun centre 6 degrees below the horizon.
 */
interface DaylightResult {
  /**
   * FOUR regimes, and the difference between the last two is legal, not
   * cosmetic:
   *   normal       the sun rises and sets.
   *   all-day      civil twilight never ends - midnight sun, or the sun
   *                sets but stays above -6 degrees. Day VFR all 24 h.
   *   no-sunrise   the sun never reaches the horizon, but it does reach
   *                -6 degrees, so a legal day-VFR twilight window EXISTS.
   *   polar-night  the sun never reaches -6 degrees: NO day-VFR window
   *                on this date at all.
   */
  kind: 'normal' | 'all-day' | 'no-sunrise' | 'polar-night';
  /** Morning civil twilight - the START of the day-VFR window. Null when
   *  there is none (deep polar night, or midnight sun). */
  mct: number | null;
  /** Evening civil twilight - the END of the day-VFR window. */
  ect: number | null;
  sunrise: number | null;
  sunset: number | null;
}

/** One place and time the winds are sampled for. */
interface WindSamplePoint {
  /** "<flightIndex>-<legIndex>". */
  legKey: string;
  fIdx: number;
  i: number;
  lat: number;
  lng: number;
  /** Leg altitude, feet - picks the pressure level to read. */
  altFt: number;
  /** Minutes after ETD, which picks the forecast hour. */
  offsetMin: number;
}

/** One pressure level in a model's vertical column. */
interface WindLevel {
  /** Geopotential height, metres. */
  h: number;
  /** Degrees the wind blows FROM. */
  dir: number;
  /** Knots. */
  spd: number;
  /** Degrees C; null when the model does not report it at that level. */
  temp: number | null;
}

/** Wind and temperature at one place, height and time. */
interface WindAtPoint {
  dir: number;
  spd: number;
  temp: number | null;
}

/**
 * The few fields of a METAR or TAF that can be read out without risk.
 * Everything else stays in `raw`, which is what a pilot reads - a decoder
 * that silently misreads a report is the failure mode this avoids.
 */
interface WeatherReport {
  /** The report exactly as published, always present. */
  raw: string;
  icao: string | null;
  /** Day of month, hour, minute - always UTC. */
  timeUTC: { day: number; hour: number; minute: number } | null;
  wind: {
    /** Degrees true; null when the direction is variable. */
    dir: number | null;
    variable: boolean;
    calm: boolean;
    speedKt: number;
    gustKt: number | null;
  } | null;
  /** Null on a TAF, which carries no observed temperature. */
  tempC: number | null;
  dewC: number | null;
  /** Hectopascals. Null for an inHg (A-prefixed) altimeter, which is NOT
   *  converted - a wrong altimeter setting is not worth the convenience. */
  qnhHpa: number | null;
  isTaf: boolean;
}

/** A choice offered in a dialog. */
interface DialogButton {
  id: string;
  label: string;
  variant?: 'primary' | 'danger' | 'ghost';
  hint?: string;
}

/** `window.C182` - the namespaced module API the page and tests use. */
interface Window {
  C182?: Record<string, unknown>;
}

/** The `magvar` package ships no type declarations of its own. */
declare module 'magvar' {
  export function calculateMagVarForDecimalYear(
    decimalYear: number, lat: number, lng: number, altKm?: number): number;
  export const MODEL_EPOCH: number;
  export const MODEL_VALID_UNTIL: number;
}
