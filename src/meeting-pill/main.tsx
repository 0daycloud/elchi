import React from "react";
import ReactDOM from "react-dom/client";
import MeetingPill from "./MeetingPill";
import "./MeetingPill.css";
import "@/styles/fonts";
import "@/i18n";
import { syncLanguageFromSettings } from "@/i18n";

// Its own webview, like the recording overlay: the pill speaks the user's language too.
syncLanguageFromSettings();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <MeetingPill />
  </React.StrictMode>,
);
