export type MentalTool = {
  id: string;
  title: string;
  description: string;
  href: string; // /mental/xxx のURL
  desktopOnly?: boolean;
};

export const mentalTools: MentalTool[] = [
  {
    id: "posture",
    title: "背筋（PCミニウィンドウ）",
    description: "小ウィンドウで「背筋」リマインダー＆開始/終了タイム計測",
    href: "/mental/posture",
    desktopOnly: true,
  },
  // ★ 今後ここに追加していくだけで /mental の一覧に出ます
  {
    id: "expressive-writing",
    title: "エクスプレッシブライティング",
    description: "不安・心配事を書き出し、後で実際どうなったかを記録して認知を整えるツール。",
    href: "/mental/expressive-writing",
  },
  {
    id: "vas",
    title: "VAS（ストレスレベル）",
    description:
      "大学・家・職場などのフォルダーごとに、ストレスレベルを0〜100で記録・比較できます。",
    href: "/mental/vas",
  },
  {
    id: "defusion",
    title: "脱フュージョン",
    description:
      "浮かんできた考えを距離を置いて観察し、代替説明や証拠を書きながら認知を柔軟にする ACT の技法。",
    href: "/mental/defusion",
  },
];
