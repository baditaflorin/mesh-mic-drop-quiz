import { createMeshConfig } from "@baditaflorin/mesh-common";

export const config = createMeshConfig({
  appName: "mesh-mic-drop-quiz",
  description: "Each peer authors one quiz Q; everyone takes turns hosting their own to the room.",
  accentHex: "#ff6699",
  version: __APP_VERSION__,
  commit: __GIT_COMMIT__,
});
