/* ---------------------------------------------------------------------------
 * Site identity switch (the only place to flip anonymous <-> public).
 *
 *   ANONYMOUS = true   Submission mode: hero shows "Anonymous authors" and
 *                      nothing below is rendered.
 *   ANONYMOUS = false  Public mode: hero renders the author list, notes,
 *                      affiliations, and resource links configured below.
 *
 * Identity data is intentionally blank in the anonymous build. Populate it
 * only in the camera-ready branch, never in the anonymous deployment.
 * ------------------------------------------------------------------------- */
export const ANONYMOUS = true;

export const IDENTITY = {
  authors: [],
  affiliations: [],
  notes: [],
  links: [
    // { label: "Paper", href: "https://..." },
    // { label: "Code", href: "https://..." },
    // { label: "Data", href: "https://..." },
  ],
};
