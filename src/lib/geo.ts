// ==============================================================
// 「ここにいる」記録(Issue #86)
//   スマートフォンで 📍 を押すと、いまいる場所をタスクとして書き留める。
//   旅行や外出のあとに一覧を見返すと足跡になっていること、が狙い。
//
//   ・逆ジオコーディング(座標→地名)は行わない。APIキーも費用も要らないため。
//     代わりに Google マップのURLをリンクへ入れ、開いて地名を確かめて
//     タスク名を直せるようにする(マップを開くだけならキーは不要)
//   ・座標はメモ、マップURLはリンクという既存フィールドに収める。
//     Task の構造を変えないので、バックアップ・インポート・他の画面は無変更で動く
//
//   位置の取得だけがブラウザAPIに依存する。それ以外は純粋関数でテスト対象。
// ==============================================================

/** この環境で位置情報が使えるか(HTTPS か localhost が必要) */
export const geoSupported =
  typeof navigator !== "undefined" && typeof navigator.geolocation !== "undefined";

/** タスク名の頭に付ける目印。一覧で「場所の記録」だと分かるように */
export const PIN = "📍";

export interface GeoPoint {
  lat: number;
  lng: number;
  /** 精度(メートル)。取れないこともある */
  accuracy?: number;
}

/**
 * 座標を文字列にする。小数6桁 ≒ 0.1m 相当で、用途には十分な精度。
 * これ以上細かくしても GPS の誤差の方が大きい。
 */
export function formatCoords(lat: number, lng: number): string {
  return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
}

/** 精度の表示。値が無い・おかしいときは空にする */
export function formatAccuracy(accuracy: number | undefined): string {
  if (accuracy === undefined || !Number.isFinite(accuracy) || accuracy <= 0) return "";
  return `±${Math.round(accuracy)}m`;
}

/**
 * Google マップで開くURL。APIキーは要らない。
 * スマートフォンではマップのアプリが起動する。
 */
export function mapsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

/** メモに残す本文。座標と精度が後から分かればよい */
export function locationMemo(p: GeoPoint): string {
  const acc = formatAccuracy(p.accuracy);
  return acc ? `${formatCoords(p.lat, p.lng)} (${acc})` : formatCoords(p.lat, p.lng);
}

/**
 * タスク名を決める。
 * 入力が空(目印だけ・空白だけ)なら座標を入れる。名前が無いと
 * 一覧で見分けが付かず、あとから地図で辿ることもできなくなるため。
 */
export function resolveTitle(input: string, p: GeoPoint): string {
  const body = input.replace(/^📍\s*/, "").trim();
  return body ? `${PIN} ${body}` : `${PIN} ${formatCoords(p.lat, p.lng)}`;
}

/** 位置情報の取得失敗を、何をすればよいか分かる日本語にする */
export function geoErrorMessage(code: number): string {
  switch (code) {
    case 1: // PERMISSION_DENIED
      return "位置情報の利用が許可されていません。ブラウザの設定で許可してください";
    case 2: // POSITION_UNAVAILABLE
      return "位置を取得できませんでした。屋内や地下では取れないことがあります";
    case 3: // TIMEOUT
      return "位置の取得に時間がかかりすぎました。もう一度試してください";
    default:
      return "位置を取得できませんでした";
  }
}

/**
 * 現在地を取得する。ユーザー操作(📍ボタン)起点で呼ぶこと。
 * 屋外の初回取得は数秒かかることがあるので、待ちすぎない程度に区切る。
 */
export function getCurrentPoint(timeoutMs = 15000): Promise<GeoPoint> {
  return new Promise((resolve, reject) => {
    if (!geoSupported) {
      reject(new Error("この環境では位置情報を使えません"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        }),
      (err) => reject(new Error(geoErrorMessage(err.code))),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 }
    );
  });
}
