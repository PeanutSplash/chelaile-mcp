export interface BusInfo {
  busId?: string;
  licence?: string;
  order?: number;
  lat?: number;
  lng?: number;
  speed?: number;
  capacity?: number;
  arrivalTime?: number;
  travelTime?: number;
  distanceToWaitStn?: number;
  distanceToDest?: number;
  nextStationName?: string;
  busDesc?: string;
  travels?: Array<{
    order?: number;
    travelTime?: number;
    arrivalTime?: number;
    recommTip?: string;
  }>;
}

export interface LineSummary {
  lineId?: string;
  name?: string;
  lineNo?: string;
  direction?: number;
  startSn?: string;
  endSn?: string;
  firstTime?: string;
  lastTime?: string;
  price?: string;
  stationsNum?: number;
}

export interface StationSummary {
  sId?: string;
  sn?: string;
  order?: number;
  lat?: number;
  lng?: number;
  wgsLat?: number;
  wgsLng?: number;
  distance?: number;
  physicalStId?: string;
  namesakeStId?: string;
}

export interface MetroSummary {
  lineId?: string;
  fullName?: string;
  lineNo?: string;
  color?: string;
}

export interface NearStop extends StationSummary {
  firstLineId?: string;
  lines?: LineItem[];
}

export interface LineItem {
  line: LineSummary;
  targetStation?: StationSummary;
  stnStates?: BusInfo[];
}

export interface NearbyResponse {
  nearSts?: NearStop[];
}

export interface StopDetailResponse {
  stationList?: Array<
    StationSummary & {
      lines?: LineItem[];
      metros?: MetroSummary[];
    }
  >;
}

export interface LineDetailResponse {
  line?: LineSummary;
  stations?: Array<StationSummary & { metros?: MetroSummary[] }>;
  buses?: BusInfo[];
  otherlines?: LineSummary[];
  depDesc?: string;
  preArrivalTime?: string;
}

export interface BusDetailResponse {
  buses?: BusInfo[];
  line?: LineSummary;
  targetOrder?: number;
  realData?: boolean;
}

export interface BusListResponse {
  targetOrder?: number;
  buses?: BusInfo[];
}

export interface RoutePoint {
  lat: number;
  lng: number;
  stopOrder?: number;
}

export interface LineRouteResponse {
  route?: RoutePoint[];
}

export interface TimetableResponse {
  line?: LineSummary;
  timeTableType?: number;
  timetable?: unknown;
  scheduleTags?: unknown[];
}

export interface RefreshResponse {
  lines?: Array<{
    line?: LineSummary;
    buses?: BusInfo[];
    depDesc?: string;
  }>;
}

export interface SearchResponse {
  result?: {
    lines?: Array<LineSummary & { subwayV2?: number }>;
    stations?: Array<
      StationSummary & { gpsType?: string; subwayV2?: number }
    >;
    pois?: Array<{
      sn1?: string;
      sn1Address?: string;
      sn1Tag?: string;
      adname?: string;
      lat?: number;
      lng?: number;
    }>;
  };
  highlightKey?: string;
}

export interface CityListResponse {
  cityList?: CityItem[];
}

export interface CityItem {
  cityId: string;
  cityName: string;
  pinyin?: string;
  supportSubway?: number;
  isHot?: number;
  isSupport?: number;
  isGpsCity?: number;
  cityVersion?: number;
}

export interface CityConfigResponse {
  arrivingStationLimitSeconds?: number;
  arrivingStationTimeDisplayConfig?: number;
  menuStyle?: number;
  locationType?: number;
  maxInterval?: number;
  busDisplayConfig?: { other?: string; lineDetail?: string };
  operationPosition?: number;
}

export interface ReverseGeoResponse {
  regeocode?: {
    formatted_address?: string;
    addressComponent?: {
      province?: string;
      city?: string | unknown[];
      district?: string;
      township?: string;
      citycode?: string;
      adcode?: string;
    };
  };
}

export interface RawTransitResponse {
  route?: {
    distance?: string;
    origin?: string;
    destination?: string;
    transits?: RawTransitPlan[];
  };
}

export interface RawTransitPlan {
  duration?: string;
  walking_distance?: string;
  distance?: string;
  cc?: number;
  tag?: string;
  via_num_total?: number;
  segments?: RawTransitSegment[];
}

export interface RawTransitSegment {
  walking?: { distance?: string; duration?: string };
  bus?: { buslines?: RawTransitBusline[] };
}

export interface RawTransitBusline {
  name?: string;
  lineType?: number;
  color?: string;
  duration?: string;
  distance?: string;
  via_num?: string;
  station_start_time?: string;
  station_end_time?: string;
  departure_stop?: { name?: string };
  arrival_stop?: { name?: string };
}

export interface TransitPlan {
  duration: number;
  walkingDistance: number;
  distance: number;
  tag: string;
  transitCount: number;
  segments: TransitSegment[];
}

export type TransitSegment =
  | { type: "walking"; distance: number; duration: number }
  | {
      type: "bus";
      name: string;
      lineType: number;
      color?: string;
      departureStop: string;
      arrivalStop: string;
      viaStops?: number;
      duration: number;
      distance: number;
      startTime: string;
      endTime: string;
    };

export interface TransitPlanResult {
  origin: string;
  destination: string;
  distance: number;
  plans: TransitPlan[];
  note?: string;
}
