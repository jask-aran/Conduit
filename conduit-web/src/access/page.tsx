import { renderToString } from "solid-js/web";
import { ConnectionScreen, PasswordSignIn } from "../components/ui/connection";
import "../components/ui/styles/theme.css";
import "../components/ui/styles/foundations.css";
import "../components/ui/styles/controls.css";
import "../components/ui/styles/connection.css";
import "./page.css";

/** Build-time HTML from the actual library. The server substitutes only escaped data. */
export const renderAccessPage = (error?: string) => renderToString(() => <ConnectionScreen><PasswordSignIn after="__CONDUIT_ACCESS_AFTER__" error={error} /></ConnectionScreen>);
