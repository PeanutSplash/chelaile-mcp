export const BASE_DOMAIN = "https://web.chelaile.net.cn";
export const BASE_URL = `${BASE_DOMAIN}/api`;

export const SIGN_SALT = "qwihrnbtmj";
export const AES_KEY = "FF32AE65FBFD19414EAAFF6291A54B42";

export const DEFAULT_PARAMS: Record<string, string> = {
  s: "h5",
  wxs: "wx_app",
  sign: "1",
  h5RealData: "1",
  v: "3.11.28",
  src: "weixinapp_cx",
  ctm_mp: "mp_wx",
  vc: "2",
  favoriteGray: "1",
  gpstype: "wgs",
  geo_type: "wgs",
  scene: "1256",
};

// Client fingerprint expected by the upstream service. Tampering with these
// values causes the upstream to reply with status:400 even when the signature
// is correct.
export const REQUEST_HEADERS: Record<string, string> = {
  Host: "web.chelaile.net.cn",
  Connection: "keep-alive",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36 MicroMessenger/7.0.20.1781(0x6700143B) NetType/WIFI MiniProgramEnv/Windows WindowsWechat/WMPF WindowsWechat(0x63090a13) UnifiedPCWindowsWechat(0xf254160a) XWEB/18055",
  xweb_xhr: "1",
  "Content-Type": "text",
  Accept: "*/*",
  "Sec-Fetch-Site": "cross-site",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Dest": "empty",
  Referer: "https://servicewechat.com/wx71d589ea01ce3321/814/page-frame.html",
  "Accept-Encoding": "gzip, deflate, br",
  "Accept-Language": "zh-CN,zh;q=0.9",
};

export const CHARACTER_LIMIT = 25000;
export const REQUEST_TIMEOUT_MS = 15000;
