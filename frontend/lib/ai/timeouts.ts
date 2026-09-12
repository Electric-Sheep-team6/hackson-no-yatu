/**
 * AI処理の時間予算。Vercel Hobby の上限 300 秒（app/api/movies/route.ts の
 * maxDuration）に収めるため、全タイムアウトをここで一元管理する。
 * after() の処理時間もこの予算に含まれる点に注意。
 *
 * 最悪ケースの内訳（シーン3本を3並列、リトライ1回）:
 *   生成準備（写真取得・署名URL）        約  5 秒
 *   脚本生成（リトライなし）              35 秒
 *   シーン生成 (70 + 15) × 2 試行        170 秒
 *   連結                                  20 秒
 *   完成動画のアップロード                約 15 秒
 *   ------------------------------------------
 *   合計                                 245 秒（余裕 55 秒）
 */

/** 脚本・偏愛分析のテキスト生成。リトライを持たないぶん短めに設定する。 */
export const TEXT_GENERATION_TIMEOUT_MS = 35_000;

/** テキスト生成のSDK内部リトライ回数。時間予算を守るため再試行しない。 */
export const TEXT_GENERATION_MAX_RETRIES = 0;

/** Gemini への1シーン分の動画生成リクエスト。 */
export const VIDEO_REQUEST_TIMEOUT_MS = 70_000;

/** 生成済みシーンを720×720へクロップするFFmpeg処理。実測では数秒で終わる。 */
export const VIDEO_PROCESS_TIMEOUT_MS = 15_000;

/** 全シーンを1本へ連結するFFmpeg処理。ストリームコピーのため短い。 */
export const VIDEO_CONCAT_TIMEOUT_MS = 20_000;
