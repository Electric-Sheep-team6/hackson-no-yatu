# LAST SCREEN AI設計・モデル選定

- 作成日: 2026-09-06
- 対象: 偏愛分析、映画構成生成、動画生成
- 前提: Next.js + Vercel + Supabase
- 料金表記: USD、各社のStandard料金（税・為替・Supabase/Vercel料金を除く）

> [!IMPORTANT]
> モデル、料金、利用上限は変更される可能性がある。実装開始時と発表前に、末尾の公式リンクを再確認すること。

## 1. 結論

MVPでは次の構成を採用する。

| 工程 | API / モデル | 用途 |
|---|---|---|
| 偏愛分析 | OpenAI Responses API / `gpt-5.6-terra` | 日記と写真から偏愛、その根拠、感情、モチーフを構造化して抽出する |
| 映画構成生成 | OpenAI Responses API / `gpt-5.6-terra` | 偏愛をあらすじ、絵コンテ、シーン別の動画プロンプトへ変換する |
| 動画生成 | Gemini API / `gemini-omni-1.1-flash` | シーンごとに3〜10秒の映像を生成する |
| 動画編集 | FFmpeg | シーン結合、字幕、ナレーション、BGM、音量調整を行う |
| 保存・配信 | Supabase Storage | 完成したMP4をprivateバケットへ保存し、署名付きURLで再生する |

`gpt-5.6-terra`はテキスト・画像入力、Structured Outputsに対応しており、品質と料金のバランスを取る用途として公式に位置付けられている。`gemini-omni-1.1-flash`は一般提供済み（GA）の動画生成モデルで、テキストまたは画像から、音声付きの短い映像を生成できる。

OpenAIのSora Video APIは非推奨で、2026年9月24日に終了予定である。そのため新規実装には採用しない。

## 2. AI処理フロー

```text
日記本文 + ユーザー写真
  ↓
1. 偏愛分析
  ↓ ObsessionAnalysis（JSON）
2. 映画構成生成
  ↓ MovieScript（JSON）
3. シーン単位の動画生成
  ↓ 3〜10秒のMP4 × 3〜5本
4. FFmpegで結合・字幕・BGM処理
  ↓
5. Supabase Storageへ保存
```

映画のあらすじを直接動画APIへ渡すだけでは、構図、カメラ、登場物、秒数が曖昧になりやすい。あらすじと動画生成の間に、シーン別のショット設計を置く。

MVPの推奨仕様は次のとおり。

- 画面比率: `16:9`
- 解像度: `720p`
- シーン数: 3シーンから開始、最大5シーン
- 1シーン: 5〜6秒を基本とする
- 完成尺: 15〜30秒
- 各生成は「単一の連続ショット」「シーン切り替えなし」と明示する
- ユーザー写真を使う場合は、可能な限りtext-to-videoではなくimage-to-videoを使う

## 3. 入出力契約

既存のバックエンド仕様にある2契約を維持しつつ、動画生成に必要なフィールドを追加する。

### 3.1 偏愛分析

```ts
type AnalyzeObsessionInput = {
  diaryTexts: string[];
  photoUrls: string[];
};

type ObsessionAnalysis = {
  title: string;
  reason: string;
  keywords: string[];
  emotion: string[];
  evidence: {
    sourceType: "diary" | "photo";
    summary: string;
  }[];
  visualMotifs: string[];
};
```

偏愛は単なる頻出語ではなく、繰り返し現れる対象、本人の感情、具体的な根拠を合わせて抽出する。写真や日記に存在しない事実を根拠として追加しないよう、`evidence`を必須にする。

### 3.2 映画構成生成

```ts
type GenerateMovieScriptInput = {
  obsession: ObsessionAnalysis;
  photoUrls: string[];
};

type MovieScript = {
  title: string;
  logline: string;
  synopsis: string;
  visualStyle: string;
  bgm: string;
  scenes: {
    order: number;
    source: string;
    duration: number;
    narration: string;
    videoPrompt: string;
    referencePhotoUrls: string[];
  }[];
};
```

`videoPrompt`には最低限、被写体、場所、動作、構図、カメラワーク、光、色、音響、禁止事項を含める。動画モデルでは英語プロンプトの評価が最も明確なため、ユーザー向け本文は日本語、`videoPrompt`は英語で生成する。

## 4. モデル別の役割

### 4.1 OpenAI `gpt-5.6-terra`

採用理由:

- 日記のテキストと写真を同じリクエストで扱える
- Structured Outputsで、DBへ保存するJSON形式を固定できる
- 偏愛の根拠抽出と創作を別の呼び出しに分離できる
- Responses APIと公式SDKを利用できる
- 最上位モデルより費用を抑えながら、分析・物語生成の品質を確保しやすい

推奨設定:

```ts
const AI_TEXT_MODEL = "gpt-5.6-terra";
```

- 偏愛分析: `reasoning.effort: "low"`から開始
- 映画構成: `reasoning.effort: "medium"`から開始
- 出力はJSON Schemaで制約し、アプリ側でもZod等で再検証する
- APIキーはサーバー側だけに置き、`NEXT_PUBLIC_`を付けない

### 4.2 Google `gemini-omni-1.1-flash`

採用理由:

- Googleが動画生成のデフォルト候補として案内している
- 一般提供済みの公式APIモデルである
- text-to-videoとimage-to-videoに対応する
- 3〜10秒、360p / 720p / 1080p / 4K、24fpsに対応する
- 生成後の動画を自然言語で修正できる
- 生成映像に音声を含められる

推奨設定:

```ts
const AI_VIDEO_MODEL = "gemini-omni-1.1-flash";
```

MVPは720pで生成する。1080pと4Kはアップスケール出力であり、処理時間と費用を確認してから採用する。

## 5. 料金

### 5.1 OpenAI `gpt-5.6-terra`

| 項目 | 料金 |
|---|---:|
| 入力 | $2.00 / 100万トークン |
| キャッシュ済み入力 | $0.20 / 100万トークン |
| 出力 | $12.00 / 100万トークン |

1作品で偏愛分析と映画構成を合わせて、入力12,000トークン、出力4,000トークンと仮定した概算:

```text
入力: 12,000 / 1,000,000 × $2.00  = $0.024
出力:  4,000 / 1,000,000 × $12.00 = $0.048
合計:                                  $0.072
```

写真入力のトークン数は画像サイズと処理設定で変わるため、この例には含めていない。テキスト生成費は動画生成費よりかなり小さいが、アップロードする写真枚数と解像度には上限を設ける。

### 5.2 Gemini Omni Flash

| 項目 | 料金 |
|---|---:|
| 入力（テキスト・画像・動画・音声） | $1.50 / 100万トークン |
| テキスト出力 | $9.00 / 100万トークン |
| 動画出力 | $17.50 / 100万トークン |
| 720p動画の実効価格 | 約$0.10 / 秒 |

動画の概算:

| 構成 | 生成秒数 | 1回生成 | 全シーンを1回再生成した場合 |
|---|---:|---:|---:|
| 3シーン × 5秒 | 15秒 | 約$1.50 | 約$3.00 |
| 3シーン × 6秒 | 18秒 | 約$1.80 | 約$3.60 |
| 5シーン × 6秒 | 30秒 | 約$3.00 | 約$6.00 |

### 5.3 作品・デモ全体の予算目安

MVPの標準を「3シーン × 6秒、平均2回生成」とすると、1作品あたりのAI費用はおよそ次のとおり。

```text
OpenAI分析・脚本: 約$0.07 + 写真入力分
Gemini動画生成:   約$3.60
合計:             約$3.67 + 写真入力分
```

デモ用の予算例:

| 作品数 | 条件 | AI費用の目安 |
|---|---|---:|
| 5作品 | 18秒、平均2回生成 | 約$18〜$20 |
| 10作品 | 18秒、平均2回生成 | 約$37〜$40 |
| 10作品 | 30秒、平均2回生成 | 約$61〜$65 |

再生成が最大のコスト要因になる。ユーザーごとの生成回数、シーン数、尺に上限を設定し、開発時は1シーンだけを再生成できるようにする。

## 6. 非同期処理と状態管理

既存の`movies.status`を次のように利用する。

```text
pending
  ↓
analyzing   OpenAIで偏愛を分析
  ↓
generating  OpenAIで映画構成とシーンプロンプトを生成
  ↓
processing  Geminiで各シーンを生成し、FFmpegで結合
  ↓
completed / failed
```

動画生成は長時間化する可能性がある。ブラウザからAI APIを直接呼ばず、サーバーまたはワーカーから呼び出す。フロントは既存仕様どおり`GET /api/movies/:id`をポーリングする。

実装時は次も保存できるようにする。

- 利用したproviderとmodel ID
- provider側のinteraction / job ID
- シーンごとの生成状態とエラー
- 実際に生成した秒数
- 再試行回数
- 可能であればproviderから得た実課金量

## 7. 実装上の安全策

- `OPENAI_API_KEY`と`GEMINI_API_KEY`はVercelのサーバー環境変数に保存する
- APIキーとSupabaseの`service_role`キーをクライアントへ返さない
- ユーザー写真の署名付きURLは、AI処理が完了するまで有効な期限にする
- AIへ送信する写真数、ファイルサイズ、解像度を制限する
- API呼び出しにタイムアウト、指数バックオフ、最大再試行回数を設定する
- 同じmovie / sceneの二重生成を防ぐため、冪等キーまたは実行ロックを持つ
- モデル出力はSchema準拠だけで信用せず、秒数、URL、配列長をアプリ側で検証する
- `failed`時はユーザー向けメッセージと内部エラーを分けて保存する

## 8. 代替候補

動画生成部分はadapterで交換可能にする。

```ts
interface VideoGenerator {
  generateScene(input: {
    prompt: string;
    duration: number;
    referenceImageUrls: string[];
  }): Promise<{
    providerJobId: string;
    videoUrl?: string;
  }>;
}
```

代替候補はRunway Gen-4.5とLuma Ray 2。どちらも公式APIでtext-to-video / image-to-videoを利用できる。ただし、ハッカソンMVPでは複数providerを同時実装せず、Geminiで問題が起きた場合にadapterを差し替える。

## 9. 今回採用しないもの

### OpenAI Sora Video API

公式APIは存在するが、すでに非推奨で2026年9月24日に完全終了予定のため採用しない。OpenAIは偏愛分析と映画構成生成に限定して利用する。

### あらすじから長尺動画を一括生成

一括生成は、シーンごとの失敗箇所を直しにくく、再生成時の費用も大きくなる。MVPでは短いシーンを個別生成してFFmpegで結合する。

## 10. 公式資料

- [OpenAI: GPT-5.6 Terra](https://developers.openai.com/api/docs/models/gpt-5.6-terra)
- [OpenAI: Responses API](https://developers.openai.com/api/reference/resources/responses/methods/create)
- [OpenAI: Sora Video API（終了予定の記載）](https://developers.openai.com/api/reference/typescript/resources/videos/methods/create)
- [Google: Video generation in the Gemini API](https://ai.google.dev/gemini-api/docs/video)
- [Google: Gemini Omni Flash model](https://ai.google.dev/gemini-api/docs/models/gemini-omni-flash)
- [Google: Gemini Omni Flash implementation guide](https://ai.google.dev/gemini-api/docs/omni)
- [Google: Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing)
- [Runway: API getting started](https://docs.dev.runwayml.com/guides/using-the-api/)
- [Luma: Dream Machine API](https://docs.lumalabs.ai/docs/api)

