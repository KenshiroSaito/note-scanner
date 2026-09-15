import type { ExtractionResult } from "../../src/schema.ts";

/*
 * Pass 1 as qwen2.5vl:7b actually returned it for note5.jpg and note6.jpg, verbatim.
 * Two runs produced byte-identical output.
 *
 * The same board photographed at two moments of a CSC 226 lecture on shortest
 * paths. Between the photos the left panel was erased and rewritten, and the
 * right "Notation" panel was extended: note5 stops at "d[v] should indicate the
 * cost of", note6 finishes the sentence.
 *
 * Pass 1 read the Notation panel as one definition with four items on note5 and
 * as four paragraphs on note6, and on note5 it wrote a note of its own that is
 * not on the board. All of it is kept exactly as returned.
 */

export const note5: ExtractionResult = {
  "source_image": "note5.jpg",
  "confidence": "high",
  "blocks": [
    {
      "type": "paragraph",
      "text": "Proof of Lemma\nFor a contradiction, assume that there exists a path P' such that w(P') < w(P). Then the path (P', P, P_k) is a shorter V_i-V_k path than P_k"
    },
    {
      "type": "definition",
      "text": "Notation",
      "items": [
        "s ∈ V will be the source vertex",
        "Let S(s, v) is the cost (or weight) of any shortest s-v path.",
        "array d of size n",
        "d[v] should indicate the cost of"
      ],
      "note": "The last item is incomplete and the note indicates it is cut off."
    }
  ]
};

export const note6: ExtractionResult = {
  "source_image": "note6.jpg",
  "confidence": "high",
  "blocks": [
    {
      "type": "paragraph",
      "text": "array π \"predecessor array\" (of size n)"
    },
    {
      "type": "paragraph",
      "text": "π[v] is predecessor of v in algorithm's currently best-known s-v path."
    },
    {
      "type": "formula",
      "text": "\\pi[v_3] = v_2, \\pi[v_2] = v_1 = s"
    },
    {
      "type": "paragraph",
      "text": "Notation s ∈ V will be the source vertex"
    },
    {
      "type": "paragraph",
      "text": "Let S(s, v) is the cost (or weight) of any shortest s-v path."
    },
    {
      "type": "paragraph",
      "text": "array d of size n"
    },
    {
      "type": "paragraph",
      "text": "d[v] should indicate the cost of algorithm's currently best-known s-v path."
    }
  ]
};
