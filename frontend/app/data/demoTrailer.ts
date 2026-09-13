// プレゼン用の固定デモデータ。
// #12（12_hybrid_plan.json / 12_hybrid_trailer_final.mp4）で実際に生成した
// 予告編と、そこから抽出済みの偏愛モチーフをそのまま埋め込んでいる。
// 実際にウェブサイト上で生成・抽出を行う機能は開発を一旦止めており、
// 対応するコードは MovieApp.tsx 内に非表示（hidden）のまま残してある。

export type DemoMotif = {
  id: string;
  name: string;
  count: number;
  description: string;
  imageSrc: string;
};

export const DEMO_TRAILER = {
  title: "あの日からの軌跡",
  logline: "やんちゃな少年から青年へ。家族と仲間に囲まれて歩んだ、かけがえのない日々の記憶。",
  videoSrc: "/demo/final-trailer.mp4",
  posterSrc: "/demo/trailer-poster.jpg",
} as const;

export const DEMO_MOTIFS: DemoMotif[] = [
  {
    id: "sparkler",
    name: "手持ち花火",
    count: 3,
    description: "夜闇を鮮やかに照らす、パチパチと火花を散らす燃焼中の手持ち花火。",
    imageSrc: "/demo/motif-sparkler.jpg",
  },
  {
    id: "kei-truck",
    name: "白い軽トラック",
    count: 2,
    description: "日本の実用的な白い軽トラック。荷台を備えた角張ったフォルム。",
    imageSrc: "/demo/motif-truck.jpg",
  },
];
