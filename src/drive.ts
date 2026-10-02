import { api } from "./api";
export type DriveStatus = {
  configured: boolean;
  googleLogin: boolean;
  pickerConfigured: boolean;
  connected: boolean;
  email?: string;
  conditionalVerified: boolean;
};
let pickerLoad: Promise<void> | undefined;
export async function pickDriveFile(
  images: boolean | "folder" = false,
): Promise<string | null> {
  const config = await api<{
    accessToken: string;
    apiKey: string;
    appId: string;
  }>("/api/drive/picker-token", { method: "POST" });
  const g = window as any;
  if (!pickerLoad)
    pickerLoad = new Promise<void>((resolve, reject) => {
      const ready = () =>
        g.gapi.load("picker", {
          callback: resolve,
          onerror: () => reject(Error("Google Picker를 불러오지 못했습니다.")),
        });
      if (g.gapi) return ready();
      const script = document.createElement("script");
      script.src = "https://apis.google.com/js/api.js";
      script.onload = ready;
      script.onerror = () =>
        reject(Error("Google Picker를 불러오지 못했습니다."));
      document.head.appendChild(script);
    }).catch((e) => {
      pickerLoad = undefined;
      throw e;
    });
  await pickerLoad;
  return new Promise((resolve) => {
    const p = g.google.picker,
      view = new p.DocsView(p.ViewId.DOCS)
        .setIncludeFolders(false)
        .setOwnedByMe(true);
    if (images === "folder")
      view
        .setIncludeFolders(true)
        .setSelectFolderEnabled(true)
        .setMimeTypes("application/vnd.google-apps.folder");
    else if (images)
      view.setMimeTypes("image/png,image/jpeg,image/webp,image/gif");
    const picker = new p.PickerBuilder()
      .addView(view)
      .setOAuthToken(config.accessToken)
      .setDeveloperKey(config.apiKey)
      .setAppId(config.appId)
      .setOrigin(location.origin)
      .setCallback((data: any) => {
        if (data.action === p.Action.PICKED) {
          const file = data.docs[0];
          picker.dispose();
          resolve(file.id);
        } else if (data.action === p.Action.CANCEL) {
          picker.dispose();
          resolve(null);
        }
      })
      .build();
    picker.setVisible(true);
  });
}
