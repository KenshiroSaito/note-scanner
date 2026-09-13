import test from 'node:test';
import assert from 'node:assert/strict';

import { latexToUnicode } from '../public/lib/latex-unicode.js';

test('converts the note2 summation to the requested form', () => {
  // The target from the request, exactly.
  assert.equal(latexToUnicode('\\sum_{e \\in A} w(e) = w(A)'), '∑(e∈A) w(e) = w(A)');
});

test('converts the operators named in the request', () => {
  assert.equal(latexToUnicode('\\sum \\int \\prod \\Delta \\alpha'), '∑ ∫ ∏ Δ α');
});

test('converts the relations and set symbols named in the request', () => {
  assert.equal(
    latexToUnicode('\\subseteq \\in \\leq \\geq \\neq \\infty'),
    '⊆ ∈ ≤ ≥ ≠ ∞',
  );
});

test('converts Greek letters in both cases', () => {
  assert.equal(latexToUnicode('\\alpha \\beta \\gamma \\pi \\omega'), 'α β γ π ω');
  assert.equal(latexToUnicode('\\Gamma \\Delta \\Sigma \\Omega'), 'Γ Δ Σ Ω');
});

test('uses real Unicode superscripts and subscripts where they exist', () => {
  assert.equal(latexToUnicode('x^2'), 'x²');
  assert.equal(latexToUnicode('a_1'), 'a₁');
  assert.equal(latexToUnicode('x^{10}'), 'x¹⁰');
  assert.equal(latexToUnicode('x^{2n}'), 'x²ⁿ');
  // Multi-character scripts still map when every character has a form.
  assert.equal(latexToUnicode('x_{i+1}'), 'xᵢ₊₁');
});

test('falls back to parentheses when a script cannot be represented', () => {
  // The rule that produces ∑(e∈A): one character with no subscript form is
  // enough to send the whole group to parentheses.
  assert.equal(latexToUnicode('\\sum_{e \\in A}'), '∑(e∈A)');
  // Upper-case letters have no subscript form at all.
  assert.equal(latexToUnicode('A_{B}'), 'A(B)');
  assert.equal(latexToUnicode('x^{\\alpha}'), 'x(α)');
});

test('flattens fractions to a slash', () => {
  assert.equal(latexToUnicode('\\frac{a}{b}'), 'a/b');
  assert.equal(latexToUnicode('\\frac{\\alpha}{2}'), 'α/2');
});

test('matches braces rather than guessing, so nesting survives', () => {
  assert.equal(latexToUnicode('\\frac{\\frac{a}{b}}{c}'), 'a/b/c');
  assert.equal(latexToUnicode('x^{\\alpha}'), 'x(α)');
});

test('keeps the text of transparent commands', () => {
  assert.equal(latexToUnicode('\\text{if } x > 0'), 'if x > 0');
  assert.equal(latexToUnicode('\\mathrm{d}x'), 'dx');
});

test('drops spacing and sizing commands', () => {
  assert.equal(latexToUnicode('\\left( x \\right)'), '( x )');
  assert.equal(latexToUnicode('a \\quad b'), 'a b');
});

test('keeps the name of an unrecognised command, without the backslash', () => {
  // "Fall back to plain text": a stray backslash is what this flavour avoids.
  assert.equal(latexToUnicode('\\foo + 1'), 'foo + 1');
});

test('strips math delimiters', () => {
  assert.equal(latexToUnicode('$x = 1$'), 'x = 1');
});

test('leaves text that is already plain alone', () => {
  assert.equal(latexToUnicode('w(A) = 12'), 'w(A) = 12');
  assert.equal(latexToUnicode(''), '');
  assert.equal(latexToUnicode(undefined), '');
});

test('never emits a backslash or a dollar sign', () => {
  // The whole point of the flavour: it must paste cleanly into an app that
  // renders no markup at all.
  const fixtures = [
    '\\sum_{e \\in A} w(e) = w(A)',
    '\\frac{\\alpha}{2} \\leq \\infty',
    'x^{2n} + a_1 \\neq \\emptyset',
    '\\text{if } A \\subseteq E \\text{ then } w(A) \\geq 0',
    '\\left( \\sum_{i=1}^{n} x_i \\right)',
    '$\\Delta x$',
    '\\unknowncommand{z}',
  ];

  for (const fixture of fixtures) {
    const converted = latexToUnicode(fixture);
    assert.ok(!converted.includes('\\'), `backslash left in: ${converted}`);
    assert.ok(!converted.includes('$'), `dollar left in: ${converted}`);
    assert.ok(!converted.includes('{'), `brace left in: ${converted}`);
  }
});

test('converts a realistic integral and summation together', () => {
  // "i=1" maps character for character, so it earns real subscripts rather
  // than the parenthesised fallback.
  assert.equal(
    latexToUnicode('\\int_0^1 f(x) dx = \\sum_{i=1}^{n} a_i'),
    '∫₀¹ f(x) dx = ∑ᵢ₌₁ⁿ aᵢ',
  );
});
