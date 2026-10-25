import type { AppRuntime } from "./app-runtime";
import { EditorDialogs } from "./EditorDialogs";
import { TemplateDialogs } from "./TemplateDialogs";
import { ExportDialogs } from "./ExportDialogs";
import { ImportDialogs } from "./ImportDialogs";
import { AppNotifications } from "./AppNotifications";
import { AiSlideDialogs } from "./AiSlideDialogs";

export function DialogStack({ app }: { app: AppRuntime }) {
  return (
    <>
      <EditorDialogs app={app} />
      <TemplateDialogs app={app} />
      <ExportDialogs app={app} />
      <ImportDialogs app={app} />
      <AppNotifications app={app} />
      <AiSlideDialogs app={app} />
    </>
  );
}
