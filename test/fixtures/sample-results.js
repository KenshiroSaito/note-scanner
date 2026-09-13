/**
 * Dummy extraction results for phase 1.
 *
 * The shape is the contract from docs/spec.md section 5 — the same JSON the
 * backend will return in phase 2 — so wiring the real call later is a swap of
 * the data source, not of the rendering code.
 *
 * @typedef {'topic'|'heading'|'paragraph'|'list'|'question'|'definition'|'formula'|'table'|'unreadable'} BlockType
 * @typedef {{ type: BlockType, text?: string, items?: string[], note?: string }} Block
 * @typedef {{ source_image: string, confidence: 'high'|'medium'|'low', blocks: Block[] }} ExtractionResult
 */

/** @type {ExtractionResult[]} */
const SAMPLE_RESULTS = [
  {
    source_image: 'IMG_0412.jpg',
    confidence: 'high',
    blocks: [
      { type: 'topic', text: 'Thermodynamics — Second Law' },
      { type: 'heading', text: 'Entropy' },
      {
        type: 'paragraph',
        text: 'Entropy measures the number of microstates consistent with a macrostate. In an isolated system it never decreases.',
      },
      { type: 'formula', text: 'S = k_B \\ln \\Omega' },
      {
        type: 'definition',
        text: 'Reversible process: one that can be run backwards leaving no net change in the system or surroundings.',
      },
      {
        type: 'list',
        text: 'Consequences of the second law',
        items: [
          'Heat flows spontaneously from hot to cold',
          'No engine can be 100% efficient',
          'Perpetual motion of the second kind is impossible',
        ],
      },
    ],
  },
  {
    source_image: 'IMG_0413.jpg',
    confidence: 'medium',
    blocks: [
      { type: 'heading', text: 'Carnot Cycle' },
      {
        type: 'paragraph',
        text: 'Four reversible stages: isothermal expansion, adiabatic expansion, isothermal compression, adiabatic compression.',
      },
      { type: 'formula', text: '\\eta = 1 - \\frac{T_c}{T_h}' },
      {
        type: 'question',
        text: 'An engine runs between 500 K and 300 K. What is its maximum efficiency?',
        items: ['A. 20%', 'B. 40%', 'C. 60%', 'D. 75%'],
      },
      {
        type: 'unreadable',
        note: 'Bottom-right corner is cut off by the page edge; two lines of working could not be read.',
      },
    ],
  },
  {
    source_image: 'IMG_0414.jpg',
    confidence: 'low',
    blocks: [
      { type: 'heading', text: 'Worked Example' },
      {
        type: 'table',
        text: '| Stage | Q | W |\n|---|---|---|\n| Isothermal expansion | +Q_h | +W |\n| Adiabatic expansion | 0 | +W |',
      },
      {
        type: 'unreadable',
        note: 'Handwriting overlaps a diagram; the final three steps could not be separated from the sketch.',
      },
    ],
  },
];

/**
 * A dummy result for one selected image, cycling through the fixtures so a
 * multi-image selection shows varied output.
 *
 * @param {string} fileName
 * @param {number} index
 * @returns {ExtractionResult}
 */
export function sampleResultFor(fileName, index) {
  const template = SAMPLE_RESULTS[index % SAMPLE_RESULTS.length];
  return { ...template, source_image: fileName };
}
