/**
 * Whether this build ships a working self-updater.
 *
 * TODO(elchi): wire Elchi's own release feed + updater signing key
 * (`plugins.updater` and `createUpdaterArtifacts` in src-tauri/tauri.conf.json,
 * `SELF_UPDATE_AVAILABLE` in src-tauri/src/settings.rs), then flip this to
 * `true`. Until then the update checker is hidden and never runs, so an Elchi
 * build can never reach Handy's release feed.
 */
export const SELF_UPDATE_AVAILABLE = false;
