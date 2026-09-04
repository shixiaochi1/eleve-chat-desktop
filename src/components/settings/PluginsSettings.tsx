import { setPluginEnabled, usePluginRecords } from "../../contrib/plugins-store";
export default function PluginsSettings() {
  const records = usePluginRecords();
  return (
    <div className="space-y-2 p-1">
      <h3 className="text-sm font-medium">Plugins</h3>
      {records.map(rec => (
        <div key={rec.id} className="flex items-center justify-between rounded-md border px-3 py-2">
          <div>
            <div className="text-sm">
              {rec.name} <span className="text-xs opacity-60">("{rec.id}")</span>
            </div>
            {rec.description ? <div className="text-xs opacity-60">{rec.description}</div> : null}
          </div>
          <button
            className={'rounded px-2 py-1 text-xs ' + (rec.enabled ? "bg-primary/20" : "bg-primary/5")}
            onClick={() => setPluginEnabled(rec.id, !rec.enabled)}
            type="button">
            {rec.enabled ? "ON" : "OFF"}
          </button>
        </div>
      ))}
      {records.length === 0 ? <div className="text-xs opacity-60">empty</div> : null}
    </div>
  );
}
