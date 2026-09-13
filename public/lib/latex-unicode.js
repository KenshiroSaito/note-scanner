/**
 * Converts LaTeX into plain Unicode.
 *
 * Some apps — Apple Notes among them — render neither LaTeX nor HTML, but
 * Unicode displays anywhere. The goal is output that looks like the board in
 * plain characters: no backslashes, no dollar signs.
 *
 * Pure, so it runs in the browser and under `node --test`.
 */

/** LaTeX command to character. */
const SYMBOLS = {
  // Operators the notes actually use
  sum: '∑', int: '∫', prod: '∏', sqrt: '√', partial: '∂', nabla: '∇',
  infty: '∞', pm: '±', mp: '∓', times: '×', div: '÷', cdot: '·', ast: '∗',

  // Relations
  leq: '≤', le: '≤', geq: '≥', ge: '≥', neq: '≠', ne: '≠',
  approx: '≈', equiv: '≡', sim: '∼', propto: '∝', ll: '≪', gg: '≫',

  // Set theory
  in: '∈', notin: '∉', ni: '∋', subset: '⊂', subseteq: '⊆',
  supset: '⊃', supseteq: '⊇', cup: '∪', cap: '∩', setminus: '∖',
  emptyset: '∅', varnothing: '∅', forall: '∀', exists: '∃', nexists: '∄',

  // Arrows
  rightarrow: '→', to: '→', leftarrow: '←', leftrightarrow: '↔',
  Rightarrow: '⇒', Leftarrow: '⇐', Leftrightarrow: '⇔', mapsto: '↦',

  // Logic and misc
  land: '∧', lor: '∨', neg: '¬', therefore: '∴', because: '∵',
  ldots: '…', cdots: '⋯', dots: '…', angle: '∠', perp: '⊥', parallel: '∥',
  degree: '°', prime: '′',

  // Greek, lower case
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε',
  zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ',
  lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ', sigma: 'σ',
  tau: 'τ', upsilon: 'υ', phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',

  // Greek, upper case
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π',
  Sigma: 'Σ', Upsilon: 'Υ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
};

/** Commands that contribute nothing once the markup is gone. */
const DROPPED = new Set(['left', 'right', 'displaystyle', 'limits', 'nolimits', 'quad', 'qquad', ',', ';', '!', ' ']);

/** Commands whose braced argument is kept verbatim. */
const TRANSPARENT = new Set(['text', 'mathrm', 'mathbf', 'mathit', 'operatorname', 'textbf', 'textit']);

const SUPERSCRIPTS = {
  0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹',
  '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽', ')': '⁾',
  a: 'ᵃ', b: 'ᵇ', c: 'ᶜ', d: 'ᵈ', e: 'ᵉ', f: 'ᶠ', g: 'ᵍ', h: 'ʰ', i: 'ⁱ',
  j: 'ʲ', k: 'ᵏ', l: 'ˡ', m: 'ᵐ', n: 'ⁿ', o: 'ᵒ', p: 'ᵖ', r: 'ʳ', s: 'ˢ',
  t: 'ᵗ', u: 'ᵘ', v: 'ᵛ', w: 'ʷ', x: 'ˣ', y: 'ʸ', z: 'ᶻ',
};

const SUBSCRIPTS = {
  0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉',
  '+': '₊', '-': '₋', '=': '₌', '(': '₍', ')': '₎',
  a: 'ₐ', e: 'ₑ', h: 'ₕ', i: 'ᵢ', j: 'ⱼ', k: 'ₖ', l: 'ₗ', m: 'ₘ', n: 'ₙ',
  o: 'ₒ', p: 'ₚ', r: 'ᵣ', s: 'ₛ', t: 'ₜ', u: 'ᵤ', v: 'ᵥ', x: 'ₓ',
};

/**
 * Read a `{...}` group starting at `open`, respecting nesting.
 *
 * Brace matching has to count depth — a regex cannot handle `\frac{\frac{a}{b}}{c}`.
 *
 * @returns {{ body: string, next: number } | null}
 */
function readGroup(source, open) {
  if (source[open] !== '{') return null;

  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return { body: source.slice(open + 1, i), next: i + 1 };
    }
  }
  return null;
}

/** The argument of ^ or _: either a braced group or the single next character. */
function readArgument(source, at) {
  const group = readGroup(source, at);
  if (group) return group;
  const character = source[at];
  return character ? { body: character, next: at + 1 } : null;
}

/**
 * Render a script, using real Unicode characters when every one of them exists
 * and falling back to parentheses when they do not.
 *
 * This single rule covers both shapes we need: `x^2` becomes `x²`, while
 * `\sum_{e \in A}` becomes `∑(e∈A)`, since `∈` has no subscript form.
 */
function renderScript(converted, table) {
  const compact = converted.replace(/\s+/g, '');
  if (!compact) return '';

  const mapped = [...compact].map((character) => table[character]);
  if (mapped.every(Boolean)) return mapped.join('');

  return `(${compact})`;
}

/**
 * Convert LaTeX source to plain Unicode.
 *
 * @param {string} latex
 * @returns {string}
 */
export function latexToUnicode(latex) {
  const source = String(latex ?? '');
  let out = '';
  let i = 0;

  while (i < source.length) {
    const character = source[i];

    if (character === '\\') {
      const match = /^\\([a-zA-Z]+|.)/.exec(source.slice(i));
      if (!match) {
        i += 1;
        continue;
      }
      const name = match[1];
      i += match[0].length;

      if (name === '\\') {
        // A line break in the source is a space once the markup is gone.
        out += ' ';
      } else if (SYMBOLS[name]) {
        out += SYMBOLS[name];
      } else if (TRANSPARENT.has(name)) {
        const group = readGroup(source, i);
        if (group) {
          out += latexToUnicode(group.body);
          i = group.next;
        }
      } else if (name === 'frac' || name === 'dfrac' || name === 'tfrac') {
        const numerator = readGroup(source, i);
        const denominator = numerator ? readGroup(source, numerator.next) : null;
        if (numerator && denominator) {
          out += `${latexToUnicode(numerator.body)}/${latexToUnicode(denominator.body)}`;
          i = denominator.next;
        }
      } else if (DROPPED.has(name)) {
        // Spacing and sizing commands leave nothing behind.
      } else {
        // No sensible Unicode form: keep the name, lose the backslash. A stray
        // backslash is exactly what this flavour exists to avoid.
        out += name;
      }
      continue;
    }

    if (character === '^' || character === '_') {
      const argument = readArgument(source, i + 1);
      if (argument) {
        const table = character === '^' ? SUPERSCRIPTS : SUBSCRIPTS;
        out += renderScript(latexToUnicode(argument.body), table);
        i = argument.next;
        continue;
      }
    }

    if (character === '{' || character === '}' || character === '$') {
      // Grouping and math delimiters carry no meaning in plain text.
      i += 1;
      continue;
    }

    out += character;
    i += 1;
  }

  // Collapse the double spaces that dropped commands leave behind.
  return out.replace(/[ \t]{2,}/g, ' ').trim();
}
