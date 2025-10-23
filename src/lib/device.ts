// frontend/src/lib/device.ts
const KEY = "support-ai:device-id";

export function getDeviceId(): string {
  if (typeof window === "undefined") return "server";
  let id = localStorage.getItem(KEY);
  if (!id) {
    // 端末ごと一意のID（ブラウザ毎に固定）
    id = crypto?.randomUUID?.() ?? `dev-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(KEY, id);
  }
  return id;
}
