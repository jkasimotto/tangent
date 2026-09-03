// The polite live region and the visible toast, both read from the announce
// store. The live node is keyed by announcement id so assistive technology
// gets a fresh node per message, as the old component did. The toast is the
// `.tangent-map-location` node the browser suites read; a surface that takes
// its place, such as the placement bar, passes `noticeHidden`.

import type { AnnounceState } from "./announce-store.ts";
import { latestAnnouncement, latestNotice } from "./announce-store.ts";

/** The store to read, and whether another surface currently stands where the toast would. */
export type LiveRegionProps = {
  readonly state: AnnounceState;
  readonly noticeHidden?: boolean;
};

/** Renders the polite live region and, unless hidden, the visible notice. */
export function LiveRegion({ state, noticeHidden = false }: LiveRegionProps) {
  const announcement = latestAnnouncement(state);
  const notice = noticeHidden ? null : latestNotice(state);
  return <>
    {notice ? <div className="tangent-map-location" aria-hidden="true">{notice.text}</div> : null}
    {announcement ? <div key={announcement.id} className="tangent-map-live" role="status" aria-live="polite" aria-atomic="true">{announcement.text}</div> : null}
  </>;
}
