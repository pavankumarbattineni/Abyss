# NNSight: Inspecting a Transformer's Internal Execution

This folder contains a runnable example that shows what happens **inside**
a transformer model between the moment you give it an input and the moment
it produces an output token — tokenization, embeddings, every transformer
layer's attention and MLP activations, the residual stream, logits, and
final generation.

## Why GPT-2, not GPT-5

NNSight works by attaching directly to a real `nn.Module` object and
intercepting its forward pass in-process (or, for very large open-weight
models such as Llama-70B/405B, on NDIF's remote infrastructure — but that
still requires the model's actual weights/architecture to exist as an
inspectable object somewhere).

GPT-5 is **closed-weight**: it only exists behind Anthropic's/OpenAI's
hosted inference API. There is no local (or even NDIF-hosted) `nn.Module`
to attach to, no way to read its layer activations, and no way to intervene
on them. This isn't an NNSight limitation specifically — **no white-box
interpretability tool** (NNSight, TransformerLens, etc.) can inspect a
model you can only reach through a text-in/text-out API. You can only
observe API-level behavior (inputs/outputs, logprobs if exposed), never
internal activations.

So this example uses **GPT-2** (`openai-community/gpt2`), a small
open-weight transformer, as a stand-in. A second script,
`inspect_qwen.py`, does the same thing against **Qwen2.5-1.5B-Instruct** —
a current, small (1.5B-parameter), decoder-only, instruction-tuned model,
architecturally representative of the same family as Llama and DeepSeek's
dense layers (RMSNorm, SwiGLU MLP, rotary position embeddings, grouped-
query attention). See "The Qwen2.5-1.5B example" below.

The exact same code pattern works for any other open-weight model (Llama,
Mistral, Gemma, DeepSeek, ...) — just change `MODEL_NAME` in the script
(and, for large models, add `remote=True` to run on NDIF instead of
locally — see the `nnsight:remote` skill for that case).

**Why not Llama or DeepSeek directly?** Llama's checkpoints on HuggingFace
are gated — you have to request access and authenticate with an HF token
before you can download them. DeepSeek's smallest open dense checkpoints
are either gated too or considerably larger than the 2-4B target. Qwen2.5
publishes small (0.5B/1.5B/3B) instruction-tuned checkpoints with no
gating at all, and shares Llama/DeepSeek's decoder-only architecture
family, so it's the most frictionless choice for local experimentation —
the same script works unchanged against
`"meta-llama/Llama-3.2-3B-Instruct"` or `"Qwen/Qwen2.5-3B-Instruct"` the
moment you have HF access to them (just edit `MODEL_NAME`).

## A version note

Different `transformers` releases disagree on whether a decoder block's
`forward()` returns just the hidden-state tensor, or a tuple of
`(hidden_state, ...extras)`. The script detects this automatically at
runtime (`unwrap_hidden` / `block_output_is_tuple` in `inspect_gpt2.py`),
so it works either way — you don't need to change anything based on your
installed `transformers` version.

## Files

- `inspect_gpt2.py` — the GPT-2 example
- `inspect_qwen.py` — the same walkthrough on Qwen2.5-1.5B-Instruct
- `logger/experiment_logger.py` — structured logging used by both scripts
- `logger/logs/` — one persistent `.log` + `.json` pair per script,
  accumulating every run (see below)
- `requirements.txt` — dependencies

## Logging

Every run of `inspect_gpt2.py` or `inspect_qwen.py` writes its full
execution/interpretability trace to `logger/logs/`, in addition to
printing to the console. Each **script** (not each run) owns exactly one
persistent pair of files:

- `logger/logs/inspect_gpt2.log` / `inspect_gpt2.json`
- `logger/logs/inspect_qwen.log` / `inspect_qwen.json`

**Every execution appends a new run — nothing is ever overwritten.**
Running the same script again, whether with a brand-new prompt, the exact
same prompt, or just repeatedly back-to-back, always adds one more entry;
every prior run stays intact in the same file. This holds however you
run it and however many times.

- **`.log`** — human-readable narrative, opened in append mode
  (`mode="a"`) so every run's output is added after the last, each
  wrapped in a clear `RUN <n> START` / `RUN <n> END` block.
- **`.json`** — a single JSON document shaped as:

  ```json
  {
    "runs": [
      {
        "run_id": 1,
        "timestamp": "2026-08-26T12:11:10.939810+00:00",
        "model": "Qwen/Qwen2.5-1.5B-Instruct",
        "prompt": "John has 3 apples. He buys 5 more apples...",
        "generated_output": "Let's break down the problem step by step:...",
        "events": [
          { "timestamp": "...", "event": "run_start", "...": "..." },
          { "timestamp": "...", "event": "model_loaded", "...": "..." },
          { "timestamp": "...", "event": "causal_intervention", "ablated_layer": 14, "...": "..." }
        ]
      },
      { "run_id": 2, "...": "next run's full record..." }
    ]
  }
  ```

  Each run entry carries a unique, sequential `run_id` (scoped to that
  script's log file), a UTC `timestamp`, the `model`, the `prompt`, a
  `generated_output` convenience field (auto-filled from whichever
  `generation` event field is present — `response` or `continuation`),
  and the full `events` array for every stage of that run — exactly what
  you need to compare runs against each other later.

  On every logged event, the **entire file is rewritten in full**, so it
  is always valid, complete JSON on disk — a run that crashes partway
  through still leaves every earlier run, and everything logged so far in
  the current run, intact and readable; nothing to repair.

  Query it directly with `jq`:

  ```bash
  # How many runs have been logged for this script so far?
  jq '.runs | length' logger/logs/inspect_qwen.json

  # Every run's prompt + what it generated, side by side
  jq '.runs[] | {run_id, prompt, generated_output}' logger/logs/inspect_qwen.json

  # Compare causal-intervention outcomes across every run of this script
  jq '.runs[].events[] | select(.event == "causal_intervention")' logger/logs/inspect_qwen.json

  # Just the logit-lens trajectory from the most recent run
  jq '.runs[-1].events[] | select(.event == "logit_lens") | .predictions' logger/logs/inspect_qwen.json
  ```

Nothing needs to be configured — `logger/logs/` and the two files are
created automatically on first run of each script. Log files are
gitignored (only `.gitkeep` is tracked) since they're generated
artifacts, not source; delete them anytime to reset a script's run
history without affecting the scripts themselves.

A run that raises an exception still logs an `error` event before the
file is closed (`try`/`finally` in each script's `main()`), so a failed
run is still reviewable afterward instead of leaving a truncated or
missing log — and every run prior to it in the file is completely
unaffected either way.

**If a script exits before logging anything at all** (e.g. `nnsight` or
`torch` isn't installed because a virtualenv wasn't activated, so the
`import` at the top of the file fails before `main()` even runs), no log
file can be produced — that failure happens before any of this script's
own code executes. If you ever run a script and see nothing appear in
`logger/logs/`, check the console output for an import-time traceback
first; a real run failure inside `main()` always produces a logged
`error` event, so the only way to get truly no log is failing before
`ExperimentLogger` is even constructed.

## STAGE 6: token-by-token generation, with a real KV cache

Both scripts' STAGE 6 traces generation one token at a time — not just
the final response text — logging, per step: the current context, every
layer's activation shapes, the final hidden state, logits, the top-5
candidate tokens **with probabilities**, and the token actually selected
(a separate field from the candidates, so it's always clear which one the
model picked vs. what else it considered). See `generation_step` events
in the JSON log, or the `Generation Step N` blocks in the `.log` file.

**No fixed token cap.** Generation runs until the model emits its own EOS
token, or — as a hard backstop, not a chosen limit — until the model's
real context window is reached (1024 tokens for GPT-2-small, 32,768 for
Qwen2.5-1.5B). In practice: GPT-2-small has no strong EOS habit for open
continuations and reliably runs to its full 1024-token limit; Qwen2.5, as
an instruction-tuned model, reliably stops itself early once its answer
is complete (127 steps for the apples-counting prompt, ending on a real
EOS token).

**This uses a real KV cache** (HF's `past_key_values`, explicitly passed
between `model.trace()` calls) — step 1 processes the full prompt; every
step after that feeds *only* the newest token and reuses cached
keys/values for everything before it, exactly like production inference.
This is also what makes running with no cap practical at all: an earlier
version of this script re-traced the *entire* growing context at every
step for simplicity, and reaching GPT-2's 1024-token limit that way would
have taken on the order of an hour on CPU; with a real cache it takes
under a minute. Each step's logged `kv_cache_bytes` is read directly off
the real cache tensors, not estimated.

**Two real bugs surfaced and got fixed while building this feature** —
worth knowing if you extend this loop further:

1. **A memory leak from missing `torch.no_grad()`.** Without it, every
   step's `past_key_values` carried a `grad_fn` back through *every*
   prior step's computation graph, so nothing was ever freed — RSS grew
   by tens of MB per step and hit multiple GB within a few hundred steps
   (verified: it drove this machine's free memory down to ~200MB before
   being caught and killed). Fixed by wrapping each step's
   `model.trace(...)` in `torch.no_grad()`.
2. **Wrong predictions from missing explicit `position_ids`/
   `attention_mask` on cached steps.** Passing only the new token to
   `model.trace()` without also passing its correct absolute
   `position_ids` and a `attention_mask` covering the full cached+new
   sequence silently defaults the new token to position 0 — corrupting
   positional embeddings/RoPE and the causal mask from step 2 onward.
   This was caught by directly diffing a cached step's output logits
   against a from-scratch full-context recompute of the same step: they
   disagreed substantially (e.g. Qwen's step-2 top prediction was `'\n'`
   at 28% confidence instead of the correct `' capital'` at ~99.99%). It
   was severe enough on GPT-2 to make greedy decoding collapse into an
   infinite `'\n'` loop for all 1017 generated tokens. Fixed by computing
   `position_ids = [[context_len_before]]` and
   `attention_mask = ones((1, context_len_before + 1))` explicitly for
   every cached step, verified afterward to produce output token-for-
   token identical to HF's own `model.generate()`.

## Setup

```bash
cd nnsight
python3 -m venv .venv          # optional but recommended
source .venv/bin/activate
pip install -r requirements.txt
```

## Running it

```bash
python3 inspect_gpt2.py
python3 inspect_qwen.py
```

The first run of each script downloads that model's weights from
HuggingFace and caches them locally (~500MB for GPT-2, ~3GB for
Qwen2.5-1.5B in bfloat16); subsequent runs are fast and offline. The Qwen
script needs a few GB of free RAM and took a few minutes on a 12-core CPU
laptop, mostly for the 40-new-token generation step in Stage 6.

## What each stage shows, and what to look for

The script traces the prompt **`"The Eiffel Tower is located in the city
of"`** through GPT-2 and prints each internal stage in order.

### Stage 1 — Tokenization
The raw string is split into subword tokens and converted to integer IDs
using GPT-2's vocabulary — this happens *before* the model does any math.
**Observe:** the prompt splits into 11 tokens, including a split word
(`'Eiffel'` → `' E'`, `'iff'`, `'el'`) — proof the model doesn't see whole
words, it sees vocabulary-dependent subword pieces.

### Stage 2 — Embeddings
Each token ID is looked up in the embedding table, producing one 768-dim
vector per token (GPT-2-small's hidden size).
**Observe:** the output shape `(1, 11, 768)` — batch size 1, 11 tokens,
768-dim vectors. This is the model's *only* input; everything below is
computed from these vectors.

### Stage 3 — Per-layer internals (attention, MLP, residual stream)
For every one of GPT-2's 12 transformer blocks, the script captures:
- `attn.output` — what that layer's self-attention sub-module produced
- `mlp.output` — what that layer's feed-forward sub-module produced
- `layer.output` — the updated residual stream (embeddings + every
  layer's contributions added so far) passed to the next layer
**Observe:** all three keep the same `(1, 11, 768)` shape at every layer —
attention and MLP outputs are *added into* the residual stream, they don't
replace it. This additive structure is why techniques like activation
patching and steering vectors work: you can inject a vector into the
residual stream at any layer and it composes with what's already there.

### Stage 4 — Logit lens (watch the prediction form layer by layer)
By running each layer's residual stream through the model's *final*
layer-norm + unembedding matrix early, you can decode what the model
"would predict" at that depth, even though it hasn't reached the last
layer yet.
**Observe:** in the recorded run, early layers predict generic filler
(`' the'`), middle layers guess geographically-adjacent but wrong answers
(`' England'`, `' Rome'`, `' London'`), and only by layer 10 does the
correct answer (`' Paris'`) lock in. This is a direct, visual demonstration
of the model progressively refining its answer layer by layer — the
"answer" isn't computed all at once, it emerges gradually through depth.

### Stage 5 — Final logits
The last layer's residual stream goes through `lm_head` to produce one
score per vocabulary token (50,257 of them for GPT-2).
**Observe:** shape `(1, 11, 50257)`. Taking the top-5 scores for the last
token position shows `' Paris'` winning, followed by other plausible
world cities (`' London'`, `' Amsterdam'`, `' Berlin'`) — the model was
never certain, it just ranked Paris highest.

### Stage 6 — Token-by-token generation, one full trace per generated token
Each new token is predicted by its own forward pass through everything in
Stages 1–5 (embeddings → 12 layers → final logits), conditioned on
everything generated so far — but instead of only keeping the final text
(as `model.generate(...)` alone would give you), this stage logs the
**complete internal state at every single step**: layer shapes, logits,
the top-5 candidate tokens with their probabilities, and the token
actually selected. See "STAGE 6: token-by-token generation, with a real
KV cache" below for exactly how — including two real bugs (a memory leak,
and a correctness bug from missing position/mask info) that came up
while building it and how they were caught and fixed.
**Observe:** for `"What is Capital city of India?"`, GPT-2-small (which
has no instruction-tuning and no fact-checking) does not reliably answer
"New Delhi" — a real run settled into repeating *"Capital city of India
is located in the state of Uttar Pradesh"* verbatim for hundreds of
tokens, a textbook case of a small base model's plausible-but-wrong
factual claims compounding into a repetition loop under greedy decoding.
Compare this to Qwen2.5-1.5B-Instruct's correct, complete answer for its
own (harder, multi-step arithmetic) prompt, below.

### Bonus — Causal intervention
Reading activations only tells you what *correlates* with the output. To
show what's *causally necessary*, the script zeroes out layer 5's output
entirely and re-runs the forward pass.
**Observe:** the prediction flips from `' Paris'` to `' and'` — proof that
layer 5 is causally load-bearing for this specific factual recall, not
just a bystander. This is the core technique (activation
patching/ablation) behind circuit-finding research — see the
`nnsight:activation-patching` and `nnsight:causal-tracing` skills for more
rigorous versions of this idea (patching in *correct* activations from a
clean run rather than zeroing, sweeping over every layer/head to build a
full causal map, etc.).

## The Qwen2.5-1.5B example

`inspect_qwen.py` follows the exact same six stages, but on a real,
current, instruction-tuned model instead of base GPT-2, so it also shows
one thing GPT-2 doesn't: a **chat template**.

### Setup differences worth noticing
- **Module names differ by architecture family.** Qwen2 (like Llama and
  DeepSeek's dense layers) organizes a decoder layer as
  `model.layers[i].self_attn` / `.mlp`, versus GPT-2's
  `transformer.h[i].attn` / `.mlp`, and normalizes with `model.norm`
  (RMSNorm) instead of GPT-2's `transformer.ln_f` (LayerNorm). The
  concepts NNSight exposes are identical — only the attribute path
  changes per model family.
- **Chat template, not raw text.** Instruction-tuned models are trained on
  a structured conversation format. `model.tokenizer.apply_chat_template(...)`
  wraps the raw question in the special role markers
  (`<|im_start|>user ... <|im_end|>`) the model was actually trained to
  expect — skipping this and feeding raw text to a chat model produces
  much worse completions.
- **28 layers, 1536-dim hidden state, 151,936-token vocabulary** — all
  much larger than GPT-2-small's 12 layers / 768 dims / 50,257 vocab, and
  it uses grouped-query attention (12 query heads sharing only 2
  key/value head groups) — a memory-saving technique GPT-2 predates.

### What the actual run showed

**Stage 4 (logit lens)** on the prompt *"The Eiffel Tower is located in
the city of"* (wrapped in the chat template) produced a much longer,
noisier climb to the right answer than GPT-2's:
```
Layer  0-15: 's'          <- uninformative early layers, longer than GPT-2's
Layer 16-17: '谢邀'         <- genuinely strange intermediate guesses
Layer 18   : '∎'
Layer 19   : 'Yes'
Layer 20-21: 'The'
Layer 22-27: ' Paris' / 'Paris'   <- locks in around layer 22 of 28
```
**Observe:** the correct answer only stabilizes in the last ~6 of 28
layers, and the intermediate "guesses" along the way are much less
semantically coherent than GPT-2's (which guessed real, wrong *cities*
the whole time). This is a real and useful finding, not a bug: raw
intermediate-layer representations in instruction-tuned chat models are
often less directly "vocabulary-shaped" than in a small base LM like
GPT-2, because more of the model's computation is organized around the
chat format and later refinement rather than an immediately human-legible
running guess. The logit lens is decoding the same linear projection at
every layer regardless of what that layer's representation is "meant" to
look like, so a wobbly, foreign-looking intermediate answer here mostly
tells you the representation at that depth isn't yet aligned with the
final vocabulary basis — not that the model is confused.

**Bonus (causal intervention)** is the more interesting result: ablating
**only** layer 14's self-attention sub-module did **not** change the
prediction at all (`'Paris'` → `'Paris'`, no change). Zeroing that same
layer's **entire output** (attention + MLP combined) did:
```
Normal top prediction:            'Paris'
After ablating layer 14 (attn only):  'Paris'   <- no effect
After ablating layer 14 (whole layer): ','      <- breaks completely
```
**Observe:** this is a genuine, useful negative result, not noise. A
28-layer instruction-tuned model has far more redundant computational
paths than GPT-2-small's 12 layers — knocking out one attention module
still leaves 27 other layers' attention *and* that same layer's MLP
intact, all of which can carry the "Paris" fact forward. You have to
remove a much larger chunk of the computation (a whole layer, not one
sub-module) before the redundancy runs out and the prediction actually
breaks. This is exactly the kind of observation activation patching
studies are built to make precise — see `nnsight:activation-patching` to
turn "ablate everything in one layer" into "find the *specific* head or
neuron responsible," which requires much less brute-force ablation.

## Where to go next

- `nnsight:logit-lens` — a deeper dive into Stage 4's technique
- `nnsight:activation-patching` / `nnsight:causal-tracing` — rigorous
  causal analysis instead of a single ablation
- `nnsight:model-steering` — persistent behavioral edits (e.g. adding a
  steering vector at every generation step, not just observing once)
- `nnsight:remote` — running these same patterns against large models
  (e.g. Llama-70B) on NDIF instead of locally
