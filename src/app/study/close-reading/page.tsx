// src/app/study/close-reading/page.tsx
import CloseReading from "@/features/study/close-reading";

export const metadata = {
  title: "精読（SVOCMタグ付け） | Support-AI",
};

export default function Page() {
  return (
    <main className="min-h-dvh">
      <CloseReading />
    </main>
  );
}
