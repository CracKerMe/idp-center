interface DeviceTrustOptionsProps {
  rememberMe: boolean;
  onRememberMeChange: (value: boolean) => void;
  trustDevice: boolean;
  onTrustDeviceChange: (value: boolean) => void;
}

export function DeviceTrustOptions({
  rememberMe,
  onRememberMeChange,
  trustDevice,
  onTrustDeviceChange,
}: DeviceTrustOptionsProps) {
  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300 cursor-pointer">
        <input
          type="checkbox"
          checked={rememberMe}
          onChange={(e) => onRememberMeChange(e.target.checked)}
          className="h-4 w-4 text-indigo-600 border-zinc-300 rounded focus:ring-indigo-500"
        />
        Remember me
      </label>
      <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300 cursor-pointer">
        <input
          type="checkbox"
          checked={trustDevice}
          onChange={(e) => onTrustDeviceChange(e.target.checked)}
          className="h-4 w-4 text-indigo-600 border-zinc-300 rounded focus:ring-indigo-500"
        />
        Trust this device
      </label>
    </div>
  );
}
