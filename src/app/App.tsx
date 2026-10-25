import { AppView } from "./AppView";
import { useAppRuntime } from "./useAppRuntime";

export function App() {
  return <AppView app={useAppRuntime()} />;
}
