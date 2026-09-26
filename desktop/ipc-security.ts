import type { IpcMainInvokeEvent, WebContents } from "electron";

export function assertTrustedSender(
  event: IpcMainInvokeEvent,
  contents: WebContents | undefined,
  expectedUrl: string,
): void {
  if (
    !contents ||
    contents.isDestroyed() ||
    event.sender !== contents ||
    !event.senderFrame ||
    event.senderFrame !== contents.mainFrame ||
    event.senderFrame.url !== expectedUrl
  ) {
    throw new Error("拒绝未经授权的应用请求。");
  }
}
