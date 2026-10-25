import { useCallback, useState } from "react";
import { appLogLocation, readAppLog, type AppLogRecord } from "../services/app-log";

export function useDiagnostics() {
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [logRecords, setLogRecords] = useState<AppLogRecord[]>([]);
  const [logLoading, setLogLoading] = useState(false);
  const [logLocation, setLogLocation] = useState<string>();
  const loadDiagnostics = useCallback(async () => {
    setLogLoading(true);
    try {
      const [records, location] = await Promise.all([readAppLog(200), appLogLocation()]);
      setLogRecords(records);
      setLogLocation(location);
    } finally {
      setLogLoading(false);
    }
  }, []);
  const openDiagnostics = () => {
    setDiagnosticsOpen(true);
    void loadDiagnostics();
  };

  return { diagnosticsOpen, setDiagnosticsOpen, logRecords, logLoading, logLocation, loadDiagnostics, openDiagnostics };
}
