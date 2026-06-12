import type { WmeSDK } from "wme-sdk-typings";

export const SCRIPT_ID = "wme-ch-street-name-checker";
export const SCRIPT_NAME = "WME CH Street Name Checker";

let sdk: WmeSDK | null = null;

// With @grant != none the script runs in Tampermonkey's isolated context, so the
// SDK bootstrap globals must be read from unsafeWindow (official SDK guidance).
function pageWindow(): Window {
  return typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
}

export async function initSdk(): Promise<WmeSDK> {
  const w = pageWindow();
  await w.SDK_INITIALIZED;
  if (!w.getWmeSdk) {
    throw new Error("getWmeSdk is not available on the page");
  }
  const instance: WmeSDK = w.getWmeSdk({ scriptId: SCRIPT_ID, scriptName: SCRIPT_NAME });
  sdk = instance;
  return instance;
}

export function getSdk(): WmeSDK {
  if (!sdk) throw new Error("SDK not initialized yet");
  return sdk;
}
