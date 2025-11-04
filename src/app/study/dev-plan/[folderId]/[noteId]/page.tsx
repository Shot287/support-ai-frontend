// src/app/study/dev-plan/[folderId]/[noteId]/page.tsx
import { DevPlanNoteDetail } from "@/features/study/DevPlanNote";

export const dynamic = "force-dynamic";

export default function DevPlanNotePage({
  params,
}: {
  params: { folderId: string; noteId: string };
}) {
  const { folderId, noteId } = params;

  return (
    <main className="max-w-4xl mx-auto space-y-4">
      <DevPlanNoteDetail folderId={folderId} noteId={noteId} />
    </main>
  );
}
