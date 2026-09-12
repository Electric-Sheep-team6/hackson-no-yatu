/**
 * AI処理の時間予算。Vercel Hobby の上限 300 秒
 * （app/api/movies/route.ts の maxDuration）に収めるため、
 * 全タイムアウトとデッドラインをここで一元管理する。
 *
 * after() の処理時間も300秒の実行時間に含まれる。
 *
 * 脚本生成と動画生成を単純に実測値へ合わせて延長すると、
 * 最悪ケースでは次のように300秒を超える。
 *
 *   生成準備（写真取得・署名URL）          約   5 秒
 *   脚本生成                               最大  90 秒
 *   シーン生成 (90 + 15) × 2 試行         最大 210 秒
 *   連結                                   最大  20 秒
 *   完成動画のアップロード                 約  15 秒
 *   ------------------------------------------------
 *   合計                                   約 340 秒
 *
 * そのため固定の最悪ケースを常に許可するのではなく、
 * GENERATION_DEADLINE_MS によるデッドライン管理方式を採用する。
 *
 * 動画生成開始から290秒を内部デッドラインとし、一過性エラーが起きた際は
 * その時点の残り時間を確認する。再試行後の生成・加工・連結・アップロードを
 * 完走するための時間が不足している場合は再試行せず、即座に失敗させる。
 *
 * シーン再試行に必要な残り時間の下限:
 *
 *   動画生成リクエスト                     90 秒
 *   シーン加工                             15 秒
 *   全シーン連結                           20 秒
 *   完成動画アップロード予約               15 秒
 *   ------------------------------------------------
 *   SCENE_RETRY_REQUIRED_MS                140 秒
 *
 * Vercelの300秒ハードリミット直前まで処理を続けないよう、
 * 最後の10秒は安全マージンとして使用しない。
 */

/** 脚本・偏愛分析のテキスト生成。実測51.7秒に対して余裕を持たせる。 */
export const TEXT_GENERATION_TIMEOUT_MS = 90_000;

/** テキスト生成のSDK内部リトライ回数。時間予算を守るため再試行しない。 */
export const TEXT_GENERATION_MAX_RETRIES = 0;

/** Gemini への1シーン分の動画生成リクエスト。 */
export const VIDEO_REQUEST_TIMEOUT_MS = 90_000;

/** 生成済みシーンを720×720へクロップするFFmpeg処理。実測では数秒で終わる。 */
export const VIDEO_PROCESS_TIMEOUT_MS = 15_000;

/** 全シーンを1本へ連結するFFmpeg処理。ストリームコピーのため短い。 */
export const VIDEO_CONCAT_TIMEOUT_MS = 20_000;

/** Vercelの300秒ハードリミット直前まで処理しないための安全余白。 */
export const SAFETY_MARGIN_MS = 10_000;

/** 動画生成処理全体で使用できる実質的な時間予算。 */
export const GENERATION_DEADLINE_MS = 300_000 - SAFETY_MARGIN_MS;

/** 完成動画のアップロード用に確保しておく見積り時間。 */
export const FINAL_UPLOAD_RESERVE_MS = 15_000;

/**
 * シーンを1回再試行した後、加工・連結・完成動画アップロードまで
 * 完走するために必要な残り時間の下限。
 */
export const SCENE_RETRY_REQUIRED_MS =
  VIDEO_REQUEST_TIMEOUT_MS
  + VIDEO_PROCESS_TIMEOUT_MS
  + VIDEO_CONCAT_TIMEOUT_MS
  + FINAL_UPLOAD_RESERVE_MS;