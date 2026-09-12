/**
 * AI処理の時間予算。Vercel Hobby の上限 300 秒
 * （app/api/movies/route.ts の maxDuration）に収めるため、
 * 全タイムアウトをここで一元管理する。
 *
 * after() の処理時間も300秒の実行時間に含まれる。
 *
 * AI呼び出しは自動再試行せず、各工程を1回だけ実行する。
 */

/** 脚本・偏愛分析のテキスト生成。実測51.7秒に対して余裕を持たせる。 */
export const TEXT_GENERATION_TIMEOUT_MS = 90_000;

/** テキスト生成のSDK内部リトライ回数。時間予算を守るため再試行しない。 */
export const TEXT_GENERATION_MAX_RETRIES = 0;

/** 偏愛オブジェクトの2K静止画生成。2件を並列で各1回だけ呼ぶ。 */
export const IMAGE_GENERATION_TIMEOUT_MS = 90_000;

/** Gemini への1シーン分の動画生成リクエスト。 */
export const VIDEO_REQUEST_TIMEOUT_MS = 90_000;

/** 生成済みシーンを720×720へクロップするFFmpeg処理。実測では数秒で終わる。 */
export const VIDEO_PROCESS_TIMEOUT_MS = 15_000;

/** 全シーンを1本へ連結するFFmpeg処理。ストリームコピーのため短い。 */
export const VIDEO_CONCAT_TIMEOUT_MS = 20_000;

/** 26枚のパン＆ズームと記録動画を42秒へ編集する。AI動画生成と並列実行する。 */
export const MEMORY_COMPOSE_TIMEOUT_MS = 90_000;

/** 42秒の実素材と14秒のAI素材をASS字幕付きで最終レンダーする。 */
export const HYBRID_COMPOSE_TIMEOUT_MS = 90_000;
