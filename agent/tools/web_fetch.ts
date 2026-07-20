import { disableTool } from "eve/tools";

// Keep arbitrary app-runtime HTTP access out of the self-hosted threat surface.
export default disableTool();
