/// <reference types="vite/client" />

import type React from "react";
import type { MingshenDesktopApi } from "../../shared/ipc";

interface MingshenWebviewElement extends HTMLElement {
  getWebContentsId(): number;
  loadURL(url: string): Promise<void>;
  reload(): void;
  goBack(): void;
  goForward(): void;
  canGoBack(): boolean;
  canGoForward(): boolean;
}

declare global {
  interface Window {
    mingshen: MingshenDesktopApi;
  }

  namespace JSX {
    interface IntrinsicElements {
      webview: React.DetailedHTMLProps<
        React.HTMLAttributes<MingshenWebviewElement> & {
          src?: string;
          partition?: string;
          useragent?: string;
          webpreferences?: string;
        },
        MingshenWebviewElement
      >;
    }
  }
}
