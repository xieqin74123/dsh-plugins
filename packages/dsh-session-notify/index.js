/**
 * Host half of the per-session notification plugin.
 *
 * All behavior lives in the browser half (`./client`), which watches the
 * Session status source, shows desktop notifications, and renders the
 * composer switch. This empty Host plugin exists only so the bundle owns a
 * Loader row: `dsh.client` in package.json exposes the browser bundle through
 * the same row, and the row's presence is what makes the client package part
 * of the composed Web module graph.
 *
 * @module @local/dsh-session-notify
 */

/** Loader plugin name. */
export const name = 'session-notify'

/** Host plugin body — no host-side behavior for this surface plugin. */
export function apply() {}
