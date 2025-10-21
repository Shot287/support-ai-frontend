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
];
