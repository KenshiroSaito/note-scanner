import test from 'node:test';
import assert from 'node:assert/strict';

import { BLOCK_TYPES, extractionJsonSchema, extractionResultSchema } from '../src/schema.ts';

/** The example from docs/spec.md section 5, fleshed out. */
const validResult = {
  source_image: 'IMG_0412.jpg',
  confidence: 'high',
  blocks: [
    { type: 'topic', text: 'Thermodynamics' },
    { type: 'heading', text: 'Entropy' },
    { type: 'paragraph', text: 'Entropy never decreases in an isolated system.' },
    { type: 'formula', text: 'S = k_B \\ln \\Omega' },
    { type: 'list', text: 'Consequences', items: ['Heat flows hot to cold', 'No perfect engine'] },
    { type: 'question', text: 'Maximum efficiency?', items: ['A. 20%', 'B. 40%'] },
    { type: 'definition', text: 'Reversible: leaves no net change.' },
    { type: 'table', text: '| Stage | Q |\n|---|---|\n| Expansion | +Q |' },
    { type: 'unreadable', note: 'Bottom-right corner is cut off.' },
  ],
};

test('accepts a full spec section 5 result', () => {
  const parsed = extractionResultSchema.safeParse(validResult);
  assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues));
});

test('accepts every documented block type', () => {
  for (const type of BLOCK_TYPES) {
    const block = type === 'unreadable' ? { type, note: 'illegible' } : { type, text: 'content' };
    const parsed = extractionResultSchema.safeParse({
      source_image: 'a.jpg',
      confidence: 'medium',
      blocks: [block],
    });
    assert.equal(parsed.success, true, `${type} should be accepted`);
  }
});

test('rejects an unknown block type', () => {
  const parsed = extractionResultSchema.safeParse({
    source_image: 'a.jpg',
    confidence: 'high',
    blocks: [{ type: 'diagram', text: 'x' }],
  });
  assert.equal(parsed.success, false);
});

test('rejects an invalid confidence value', () => {
  const parsed = extractionResultSchema.safeParse({
    source_image: 'a.jpg',
    confidence: 'very high',
    blocks: [],
  });
  assert.equal(parsed.success, false);
});

test('rejects a missing or empty source_image', () => {
  assert.equal(extractionResultSchema.safeParse({ confidence: 'high', blocks: [] }).success, false);
  assert.equal(
    extractionResultSchema.safeParse({ source_image: '', confidence: 'high', blocks: [] }).success,
    false,
  );
});

test('requires a note on an unreadable block', () => {
  // An unreadable block that does not say what was unreadable helps nobody.
  const parsed = extractionResultSchema.safeParse({
    source_image: 'a.jpg',
    confidence: 'low',
    blocks: [{ type: 'unreadable' }],
  });
  assert.equal(parsed.success, false);

  const blank = extractionResultSchema.safeParse({
    source_image: 'a.jpg',
    confidence: 'low',
    blocks: [{ type: 'unreadable', note: '   ' }],
  });
  assert.equal(blank.success, false);
});

test('requires content on blocks that are not unreadable', () => {
  const parsed = extractionResultSchema.safeParse({
    source_image: 'a.jpg',
    confidence: 'high',
    blocks: [{ type: 'paragraph' }],
  });
  assert.equal(parsed.success, false);
});

test('accepts a list that carries only items', () => {
  const parsed = extractionResultSchema.safeParse({
    source_image: 'a.jpg',
    confidence: 'high',
    blocks: [{ type: 'list', items: ['one', 'two'] }],
  });
  assert.equal(parsed.success, true);
});

test('strips unknown keys instead of failing the whole page', () => {
  const parsed = extractionResultSchema.safeParse({
    source_image: 'a.jpg',
    confidence: 'high',
    blocks: [{ type: 'heading', text: 'X', bbox: [0, 0, 10, 10] }],
    model_notes: 'chatty extra field',
  });

  assert.equal(parsed.success, true);
  assert.ok(parsed.data && !('model_notes' in parsed.data));
  assert.ok(parsed.data && !('bbox' in parsed.data.blocks[0]!));
});

test('exposes a JSON Schema for constrained decoding', () => {
  const jsonSchema = extractionJsonSchema();
  assert.equal(jsonSchema.type, 'object');

  const properties = jsonSchema.properties as Record<string, unknown>;
  assert.deepEqual(Object.keys(properties).sort(), ['blocks', 'confidence', 'source_image']);
});

test('drops empty items and notes the model fills in anyway', () => {
  // Constrained decoding makes models emit "items": [] and "note": "" on every
  // block; an empty array is truthy and would render as an empty list.
  const parsed = extractionResultSchema.safeParse({
    source_image: 'note1.jpg',
    confidence: 'high',
    blocks: [{ type: 'paragraph', text: 'V. Mem', items: [], note: '' }],
  });

  assert.equal(parsed.success, true);
  assert.deepEqual(parsed.data?.blocks[0], { type: 'paragraph', text: 'V. Mem' });
});

test('keeps items and notes that carry content', () => {
  const parsed = extractionResultSchema.safeParse({
    source_image: 'note1.jpg',
    confidence: 'high',
    blocks: [
      { type: 'list', text: 'Mechanisms', items: ['interrupts', 'dual mode'] },
      { type: 'unreadable', note: 'margin is cut off' },
    ],
  });

  assert.equal(parsed.success, true);
  assert.deepEqual(parsed.data?.blocks[0], {
    type: 'list',
    text: 'Mechanisms',
    items: ['interrupts', 'dual mode'],
  });
  assert.deepEqual(parsed.data?.blocks[1], { type: 'unreadable', note: 'margin is cut off' });
});
