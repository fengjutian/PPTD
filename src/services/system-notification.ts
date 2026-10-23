import { isDesktopRuntime } from "./project-files";

export interface SystemNotification {
  title: string;
  body: string;
}

/**
 * 请求一次通知权限。桌面端使用 Tauri 原生插件；浏览器预览才使用 Web API。
 * 权限请求失败不会影响主流程，页面内状态仍是最后一道可见反馈。
 */
export async function prepareSystemNotifications(): Promise<boolean> {
  try {
    if (isDesktopRuntime()) {
      const { isPermissionGranted, requestPermission } = await import("@tauri-apps/plugin-notification");
      if (await isPermissionGranted()) return true;
      return (await requestPermission()) === "granted";
    }
    if (!("Notification" in window)) return false;
    if (Notification.permission === "granted") return true;
    if (Notification.permission === "denied") return false;
    return (await Notification.requestPermission()) === "granted";
  } catch {
    return false;
  }
}

/** 发送操作系统通知；调用失败时安静降级，不覆盖真正的业务错误。 */
export async function notifySystem(notification: SystemNotification): Promise<void> {
  try {
    if (!(await prepareSystemNotifications())) return;
    if (isDesktopRuntime()) {
      const { sendNotification } = await import("@tauri-apps/plugin-notification");
      sendNotification(notification);
      return;
    }
    new Notification(notification.title, { body: notification.body });
  } catch {
    // 通知只是错误呈现通道，不能反过来使生成、保存或导出失败。
  }
}
