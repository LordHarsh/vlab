/**
 * Institutional attribution shown in the footer of every page inside a lab.
 *
 * WHY THIS EXISTS AS A MODULE
 *
 * The single loudest "this is a real academic lab and not a product" signal on
 * the reference site (srmeeevlab.github.io) is that every footer on every
 * sub-page repeats the same department + institute + programme + licence block.
 * A SaaS product never puts a legal licence badge on every page; a
 * nationally-funded courseware programme always does.
 *
 * The strings below are PLACEHOLDERS, deliberately generic. They are the one
 * piece of this restyle that a deploying department must replace with its own
 * details — they are collected here, in one file, rather than inlined into the
 * footer markup so that replacing them is a single edit and cannot drift
 * between the student, educator and admin shells.
 *
 * Nothing here claims affiliation with any specific real institution.
 */

export const INSTITUTION = {
  /** Product / lab-platform name, as it appears in the copyright line. */
  platform: 'VLab',

  /** Owning academic department. */
  department: 'Department of Electronics & Communication Engineering',

  /** Programme the lab is published under. */
  programme: 'Virtual Labs initiative — open courseware for engineering education',

  /** Short banner subtitle used under the platform wordmark in the header. */
  tagline: 'Virtual Laboratory for Electronics & Embedded Systems',
} as const

/**
 * Content licence. The reference publishes every lab under CC BY-NC-ND 4.0 and
 * spells the full licence name out in prose each time rather than abbreviating
 * it — that bureaucratic completeness is part of the register, so it is kept.
 */
export const CONTENT_LICENCE = {
  name: 'Creative Commons Attribution-NonCommercial-NoDerivatives 4.0 International License',
  shortName: 'CC BY-NC-ND 4.0',
  url: 'https://creativecommons.org/licenses/by-nc-nd/4.0/',
  badge: '/images/cc-by-nc-nd.svg',
} as const
