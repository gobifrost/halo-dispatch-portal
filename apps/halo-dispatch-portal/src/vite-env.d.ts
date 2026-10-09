/// <reference types="vite/client" />

interface BifrostAppBoot {
  appId?: string | null;
  baseUrl?: string;
  basename?: string;
  mountEl?: HTMLElement;
  onLogout?: () => void;
  orgScope?: string | null;
  registerUnmount?: (handler: () => void) => void;
  theme?: "light" | "dark";
  token?: string;
}

interface Window {
  __BIFROST_APP__?: BifrostAppBoot;
  __BIFROST_APPS__?: Record<string, BifrostAppBoot>;
}
