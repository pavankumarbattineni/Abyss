# Qwen2.5-1.5B-Instruct — End-to-End Transformer Walkthrough (Run 1)

This document traces the **complete internal execution** of a decoder-only
Transformer, using one real, logged execution as the concrete example:
**`inspect_qwen.py` `run_id: 1`**, recorded in
[`logger/logs/inspect_qwen.json`](logger/logs/inspect_qwen.json).

Every number, shape, token, and prediction quoted below either (a) comes
directly from that run's logged events, or (b) was pulled freshly from
the actual loaded model/config to fill in details the run's logging
doesn't capture (e.g. individual Q/K/V projection shapes, RoPE's base
frequency). Anywhere (b) applies, it's marked **[from model config]** or
**[verified live]** so you can tell logged fact from supplementary
architecture detail. Nothing here is a generic textbook description
detached from this run.

---

## 0. Run 1 at a glance

| Field | Value |
|---|---|
| `run_id` | 1 |
| `timestamp` | `2026-08-26T12:11:10.939810+00:00` |
| `model` | `Qwen/Qwen2.5-1.5B-Instruct` |
| Architecture | Decoder-only Transformer (`Qwen2ForCausalLM`) — same family as GPT-2, Llama, DeepSeek |
| User prompt | *"John has 3 apples. He buys 5 more apples and gives 2 apples to his friend. How many apples does John have now? Explain your reasoning step by step."* |
| Prompt after chat template | 65 tokens |
| Generated response | *"Let's break down the problem step by step: ..."* (120 max new tokens) |

Model dimensions, as logged by the `model_loaded` event of run 1:

| Config | Value | Source |
|---|---|---|
| Decoder layers | **28** | logged |
| Hidden size ($d_{model}$) | **1536** | logged |
| Attention heads (query) | **12** | logged |
| Key/value heads (GQA) | **2** | logged |
| Vocabulary size | **151,936** | logged |
| Head dimension ($d_k$) | **128** (`1536 / 12`) | derived |
| MLP intermediate size | **8960** | [from model config] |
| RMSNorm $\epsilon$ | **1e-6** | [from model config] |
| RoPE base ($\theta$) | **1,000,000** | [from model config] |
| Activation function | **SiLU** (used in a SwiGLU-style MLP) | [from model config] |
| Weight tying | `lm_head` **shares weights** with the input embedding table | [from model config] |
| Total parameters | **1.54B** | [verified live] |

---

## 0a. Architecture flow diagram — Qwen2.5-1.5B-Instruct, Run 1

This is the same generic decoder-only shape as GPT-2, but with the
specific components Qwen2.5 actually uses at every stage — **RMSNorm
instead of LayerNorm, RoPE instead of learned positional embeddings,
Grouped-Query Attention (12 query heads sharing only 2 key/value heads)
instead of plain multi-head attention, and a gated SwiGLU MLP instead of
a plain feed-forward**. Shapes shown are the real tensor shapes logged
for run 1 at every stage; the box repeats **28 times**, once per decoder
layer, per the logged `num_layers: 28`.

```text
Input Prompt
"John has 3 apples. He buys 5 more apples and gives 2 apples..."
    |
    v
Chat template  (apply_chat_template — wraps in <|im_start|>/<|im_end|>)
    |
    v
BPE Tokenizer
    |
    v
Token IDs                                    65 tokens  [151644, 8948, ...]
    |
    v
Token Embedding Lookup  (E_i = W_E[x_i])
    |
    v
H(0): Hidden States                          shape [1, 65, 1536]
    |
    |   (RoPE angles are computed once from position indices 0..64,
    |    theta_base=1,000,000, and reused inside every layer below --
    |    NOT added to H(0) here, unlike a learned positional embedding)
    |
    v
┌──────────────────────────────────────────────────────────────┐
│  Decoder Layer 1  of 28   (Qwen2DecoderLayer)                 │
│                                                                 │
│   residual_in = H(0)                       [1, 65, 1536]      │
│        |                                                       │
│        v                                                       │
│   RMSNorm  (input_layernorm, eps=1e-6)                         │
│        |                                                       │
│        v                                                       │
│   Q,K,V Projections                                            │
│     Q: Linear(1536->1536, bias)   -> 12 heads x 128            │
│     K: Linear(1536-> 256, bias)   ->  2 heads x 128  (GQA)     │
│     V: Linear(1536-> 256, bias)   ->  2 heads x 128  (GQA)     │
│        |                                                       │
│        v                                                       │
│   RoPE  applied to Q and K only  (rotate by position m)        │
│        |                                                       │
│        v                                                       │
│   Grouped-Query Expansion  (2 KV heads repeated x6 -> 12)       │
│        |                                                       │
│        v                                                       │
│   Causal Self-Attention (per head)                             │
│     scores = Q·K^T / sqrt(128) + causal_mask                   │
│     weights = softmax(scores)                                  │
│     head_out = weights · V                                     │
│        |                                                       │
│        v                                                       │
│   Concat 12 heads -> Output Projection  o_proj (1536->1536)    │
│        |                                        self_attn_out  │
│        |                                        [1, 65, 1536]  │
│        v                                                       │
│   Residual Connection #1   H_mid = residual_in + self_attn_out │
│        |                                                       │
│        v                                                       │
│   RMSNorm  (post_attention_layernorm, eps=1e-6)                │
│        |                                                       │
│        v                                                       │
│   MLP / SwiGLU Feed-Forward                                    │
│     gate = Linear(1536->8960)(y)     -> SiLU(gate)              │
│     up   = Linear(1536->8960)(y)                                │
│     down = Linear(8960->1536)( SiLU(gate) * up )                │
│        |                                        mlp_out        │
│        |                                        [1, 65, 1536]  │
│        v                                                       │
│   Residual Connection #2   H(1) = H_mid + mlp_out               │
│                                             [1, 65, 1536]      │
└──────────────────────────────────────────────────────────────┘
    |
    v
        ... identical block structure repeats ...
    |
    v
┌──────────────────────────────────────────────────────────────┐
│  Decoder Layer 28  of 28                                       │
│  (same internal structure as Layer 1, shown above)              │
│                                             H(28) [1, 65, 1536] │
└──────────────────────────────────────────────────────────────┘
    |
    v
Final RMSNorm  (model.norm, eps=1e-6)
    |
    v
LM Head  (Linear, weight-tied to the embedding table: W_U = W_E^T)
    |
    v
Logits                                        shape [1, 65, 151936]
    |
    v
Softmax  (last position only, for next-token prediction)
    |
    v
Token Probabilities        'Let' 56.76%, 'To' 18.43%, 'Sure' 11.18%, ...
    |
    v
Token Selection  (greedy argmax, do_sample=False)
    |
    v
Generated Token: "Let"
    |
    v
KV Cache Update + Append Token -----> feed back in as next input
    |                                  (repeat the whole pipeline
    |                                   above, reusing cached K/V,
    v                                   for up to max_new_tokens=120)
Autoregressive Loop  (Section 8c)
    |
    v
Final Response
"Let's break down the problem step by step: ... 8 - 2 = 6. So"
```

### Reading the diagram against run 1's actual logged events

| Diagram stage | Logged event (run 1) | What it shows |
|---|---|---|
| Input Prompt → Chat template → Tokenizer → Token IDs | `tokenization` | 65 tokens; exact chat-templated string and per-token breakdown in Section 1 |
| Token Embedding Lookup → H(0) | `embeddings` | Shape `[1, 65, 1536]` — see Section 2 |
| *(RoPE — no separate event; applied inside every layer's attention, not logged as a standalone step)* | — | See Section 3 for why RoPE has no shape-changing log entry of its own |
| Decoder Layer 1–28 (each box) | `layer_shapes` | Per-layer `self_attn_out_shape`, `mlp_out_shape`, `residual_stream_shape` — all `[1, 65, 1536]` for all 28 layers, plus the version-specific `layer_output_is_tuple: false` flag — see Section 4 |
| Q,K,V Projections / GQA expansion / Causal Self-Attention | *(shapes logged; individual Q/K/V tensors are not — projection shapes below are [verified live])* | See Section 5 |
| Residual Connections #1 and #2 | *(implicit in `layer_shapes` staying constant across all layers)* | See Section 6 |
| Final RMSNorm → LM Head → Logits | `final_logits` | Shape `[1, 65, 151936]`, top-5 logits — see Section 7 |
| *(bonus: logit lens at every intermediate H(l), not just H(28))* | `logit_lens` | Per-layer top predicted token, layers 0–27 — see Section 7a |
| Softmax → Token Probabilities → Token Selection | `final_logits` (re-derived) | Exact recomputed softmax probabilities — see Section 7b–8a |
| Generated Token → Autoregressive Loop → Final Response | `generation` | Full 120-token response, matching the greedy `'Let'` prediction — see Section 8 |
| *(not in the main flow — a separate diagnostic re-run)* | `causal_intervention` | Layer 14 ablation, proving causal necessity — see Section 9 |

---

## 1. Tokenization — text → token IDs

**This is the only stage that happens *before* any tensor math.** The raw
user string is never seen by the neural network; only integer token IDs
are.

### 1a. The chat template

Qwen2.5-1.5B-Instruct is instruction-tuned — it was trained on a
structured conversation format, not raw text. Before tokenizing, the
script (`inspect_qwen.py`) wraps the user's message using
`tokenizer.apply_chat_template(...)`. The **exact string that was fed to
the tokenizer** for run 1 (logged verbatim in the `tokenization` event):

```
<|im_start|>system
You are Qwen, created by Alibaba Cloud. You are a helpful assistant.<|im_end|>
<|im_start|>user
John has 3 apples. He buys 5 more apples and gives 2 apples to his friend. How many apples does John have now? Explain your reasoning step by step.<|im_end|>
<|im_start|>assistant
```

Skipping this template and feeding raw text to an instruction-tuned model
produces much worse completions — the model was never trained to expect
unstructured text as a "conversation."

### 1b. Byte-Pair Encoding (BPE) tokenization

The templated string is split into **65 tokens** (`num_tokens: 65`,
logged) using Qwen's BPE vocabulary (151,936 tokens total). Re-tokenizing
the exact same string **[verified live]** gives the precise token-by-token
breakdown:

| # | Token ID | Token string |
|---|---|---|
| 0 | 151644 | `<\|im_start\|>` |
| 1 | 8948 | `system` |
| 2 | 198 | `\n` |
| 3–18 | ... | *(system prompt text — "You are Qwen, created by ... assistant.")* |
| 19 | 151645 | `<\|im_end\|>` |
| 20 | 198 | `\n` |
| 21 | 151644 | `<\|im_start\|>` |
| 22 | 872 | `user` |
| 23 | 198 | `\n` |
| **24** | **13079** | **`John`** |
| 25 | 702 | ` has` |
| 26 | 220 | ` ` |
| **27** | **18** | **`3`** |
| 28 | 40676 | ` apples` |
| 29 | 13 | `.` |
| 30 | 1260 | ` He` |
| 31 | 49531 | ` buys` |
| 32 | 220 | ` ` |
| **33** | **20** | **`5`** |
| 34 | 803 | ` more` |
| 35 | 40676 | ` apples` |
| 36 | 323 | ` and` |
| 37 | 6696 | ` gives` |
| 38 | 220 | ` ` |
| **39** | **17** | **`2`** |
| 40 | 40676 | ` apples` |
| 41–52 | ... | *("to his friend. How many apples does John have now?")* |
| 53–59 | ... | *("Explain your reasoning step by step.")* |
| 60 | 151645 | `<\|im_end\|>` |
| 61 | 198 | `\n` |
| 62 | 151644 | `<\|im_start\|>` |
| 63 | 77091 | `assistant` |
| 64 | 198 | `\n` |

A few things worth noticing directly in this table:
- **Numbers are single tokens**: `3` → id `18`, `5` → id `20`, `2` → id
  `17`. The model doesn't do arithmetic on digit characters — it has to
  recover "3", "5", "2" as *discrete vocabulary symbols* and reconstruct
  their numeric meaning entirely from what it learned during training.
  This is directly relevant to the reasoning task in this prompt.
- `apples` (id `40676`) is a **single token** every time it appears
  (positions 28, 35, 40, 47) — a whole word, not sub-worded, because it's
  common enough to have its own vocabulary entry.
- Special control tokens (`<|im_start|>`, `<|im_end|>`, role names) are
  **not natural language** — they're structural markers the model was
  trained to recognize as conversation boundaries.
- Total: **65 tokens**, matching the logged `num_tokens: 65` exactly.

From here on, the model only ever sees a sequence of 65 integers in
$[0, 151936)$ — call this sequence $x_1, x_2, \dots, x_{65}$.

---

## 2. Embedding lookup — token IDs → vectors

Logged by run 1's `embeddings` event:

```json
{"event": "embeddings", "shape": [1, 65, 1536]}
```

Each of the 65 token IDs is used to index a row out of the model's
embedding table $W_E \in \mathbb{R}^{151936 \times 1536}$:

$$
E_i = W_E[x_i], \qquad E_i \in \mathbb{R}^{1536}
$$

Stacking all 65 positions gives the initial hidden-state tensor:

$$
H^{(0)} \in \mathbb{R}^{1 \times 65 \times 1536}
$$

— **batch size 1, 65 tokens, 1536-dimensional vector per token.** This
exactly matches the logged shape `[1, 65, 1536]`. $H^{(0)}$ is the *only*
input to the 28 decoder layers that follow — everything the model
"knows" about this prompt has to be recoverable from these 65 vectors
plus the position each one sits at.

**Weight tying** [from model config]: this same matrix $W_E$ is reused
(transposed) as the final unembedding matrix at the very end (Section 7).
Qwen2.5-1.5B doesn't learn two separate 233M-parameter matrices for "turn
tokens into vectors" and "turn vectors back into token scores" — it
learns one and uses it both directions.

---

## 3. Positional information — RoPE (Rotary Position Embeddings)

Unlike GPT-2 (which adds a separate learned positional-embedding vector
to $H^{(0)}$ before the first layer — see `inspect_gpt2.py`), Qwen2, like
Llama and most modern decoder-only models, uses **Rotary Position
Embeddings (RoPE)**. This is why run 1's `embeddings` event shows only
one 1536-dim vector per token, with **no separate positional-embedding
addition step logged** — RoPE isn't added to the residual stream at all;
it's applied *inside* every attention layer's Q and K vectors, at
attention-computation time, not once at the input.

**Why this matters for interpretability**: if you only capture the
embedding output (as run 1 does) and see plain token embeddings with no
positional signal mixed in, that's *expected* for a RoPE model, not a
sign anything was skipped.

### 3a. The mechanism

For each attention head, RoPE rotates pairs of dimensions of the
query/key vectors by an angle proportional to the token's position $m$
and a frequency that depends on the dimension pair index $i$:

$$
\theta_i = \theta_{\text{base}}^{-2i/d_k}, \qquad i \in \{0, 1, \dots, d_k/2 - 1\}
$$

With **head dimension $d_k = 128$** (logged: $1536 / 12$ heads) and
**$\theta_{\text{base}} = 1{,}000{,}000$** [from model config], each pair
of dimensions $(2i, 2i{+}1)$ in a head's query/key vector is rotated by
angle $m\theta_i$ using the standard 2D rotation matrix:

$$
\begin{pmatrix} q'_{2i} \\ q'_{2i+1} \end{pmatrix}
=
\begin{pmatrix} \cos(m\theta_i) & -\sin(m\theta_i) \\ \sin(m\theta_i) & \cos(m\theta_i) \end{pmatrix}
\begin{pmatrix} q_{2i} \\ q_{2i+1} \end{pmatrix}
$$

Low-index dimension pairs ($i$ near 0) rotate quickly with position;
high-index pairs rotate very slowly — giving the model a
multi-resolution notion of "how far apart are these two tokens," encoded
directly into the geometry of Q and K, not as extra information appended
to the vector.

The practical consequence for token 24 (`John`, the subject of the
question) versus token 63 (`assistant`, near the very end): both start
from token embeddings computed completely independently of position (per
Section 2), but by the time they're compared inside attention (Section
5), each has been rotated by an angle tied to *its own* position (24 vs.
63) — so the *same* dot product between two tokens' Q/K vectors comes
out differently depending on how far apart they are, without a single
extra parameter added to the residual stream.

**$1{,}000{,}000$ as the RoPE base**, rather than the original RoPE
paper's $10{,}000$, is a deliberate Qwen2/2.5 choice to keep positional
signal usable over Qwen's long context window (**32,768 tokens**, `
max_position_embeddings` [from model config]) — a much larger base
slows the fastest-rotating dimensions down proportionally, preserving
resolution over more positions. Run 1's actual sequence (65 tokens) uses
only a tiny fraction of that budget.

---

## 4. The 28 decoder layers — overall shape

Run 1's `layer_shapes` event logged, for **every one of the 28 layers**,
the shape of that layer's self-attention output, MLP output, and
resulting residual stream:

```json
{
  "layer_output_is_tuple": false,
  "layers": [
    {"layer": 0,  "self_attn_out_shape": [1, 65, 1536], "mlp_out_shape": [1, 65, 1536], "residual_stream_shape": [1, 65, 1536]},
    { "...": "identical shapes repeat for all 28 layers, layer 1 through layer 27" }
  ]
}
```

Every one of the 28 layers preserves the exact same shape,
`[1, 65, 1536]`, all the way through. This is the residual-stream
invariant that makes deep Transformers trainable: nothing about a
layer's job requires changing the tensor's shape — every layer reads
the 1536-dim vector at each of the 65 positions, computes an update, and
adds it back in the same shape.

**`layer_output_is_tuple: false`** — logged directly by run 1 — is a
concrete, version-specific detail: in the installed `transformers`
release, `Qwen2DecoderLayer.forward()` returns the hidden-state tensor
*directly*, not wrapped in a tuple with cache/attention extras. (Compare
to `inspect_gpt2.py`, where the equivalent flag came out `true` for
GPT-2's `transformers` version — the two scripts had to handle this
difference explicitly; see the "version note" in `README.md`.)

Each of the 28 `Qwen2DecoderLayer` modules [verified live from the loaded
model] performs, in order:

```
input  = H^(l-1)                                    # residual stream in
x      = RMSNorm(input)             [input_layernorm]
attn   = SelfAttention(x)                            # Section 5
H_mid  = input + attn                                # residual connection #1
y      = RMSNorm(H_mid)             [post_attention_layernorm]
mlp    = MLP(y)                                      # Section 6
H^(l)  = H_mid + mlp                                 # residual connection #2
```

This is a **pre-norm** architecture: normalization happens *before* each
sub-layer (attention, MLP), not after — the residual connections carry
the raw, un-normalized sum forward. This is why RMSNorm shows up twice
per layer (`input_layernorm` and `post_attention_layernorm`) but the
*shape* logged for `residual_stream_shape` never reflects a
normalization step directly — normalization is a side computation feeding
into attention/MLP, not a shape-changing operation on the residual
stream itself.

### 4a. RMSNorm — the normalization used at every step

Qwen2 uses **RMSNorm**, not the LayerNorm used in GPT-2. RMSNorm skips
mean-centering entirely and only rescales by the root-mean-square of the
activations:

$$
\text{RMSNorm}(x) = \frac{x}{\sqrt{\frac{1}{d}\sum_{j=1}^{d} x_j^2 + \epsilon}} \odot \gamma
$$

with $d = 1536$ (hidden size), $\epsilon = \mathbf{1\text{e-}6}$
[from model config], and $\gamma \in \mathbb{R}^{1536}$ a learned
per-dimension scale (one such $\gamma$ for `input_layernorm`, a
*different* one for `post_attention_layernorm`, at every one of the 28
layers — 56 learned RMSNorm scale vectors total, plus one more for the
final norm in Section 7). RMSNorm is cheaper than LayerNorm (no mean
subtraction) and is the standard choice in Llama/Qwen/DeepSeek-family
models.

---

## 5. Self-attention — Grouped-Query Attention (GQA) in detail

This is the mechanism that lets every token's representation be updated
by *mixing in information from other tokens* — the part of the
Transformer that reasons about relationships between positions (e.g.
connecting `John` at position 24 to `apples` at position 28, or the
number `5` at position 33 to the operation implied by `buys` at position
31).

### 5a. Q, K, V projections

At every layer, the normalized input $x \in \mathbb{R}^{1 \times 65
\times 1536}$ is linearly projected into queries, keys, and values:

$$
Q = xW_Q + b_Q, \qquad K = xW_K + b_K, \qquad V = xW_V + b_V
$$

**Exact projection shapes, pulled directly from the loaded model**
[verified live]:

| Projection | Weight shape | Bias | Output dim |
|---|---|---|---|
| `q_proj` | `[1536, 1536]` | **yes** | 1536 → 12 heads × 128 |
| `k_proj` | `[256, 1536]` | **yes** | 256 → 2 heads × 128 |
| `v_proj` | `[256, 1536]` | **yes** | 256 → 2 heads × 128 |
| `o_proj` | `[1536, 1536]` | no | 1536 |

Two things worth flagging explicitly:
1. **Qwen2's Q/K/V projections carry a bias term** (`b_Q, b_K, b_V`), while
   the output projection `o_proj` does not. This is a specific Qwen2
   architectural choice (not universal across all decoder-only models —
   e.g. Llama's attention projections are bias-free).
2. **K and V are projected down to only 256 dimensions**, not 1536 — this
   is Grouped-Query Attention (GQA), explained next.

After projection, $Q$ is reshaped into **12 heads of dimension 128**,
while $K$ and $V$ are reshaped into only **2 heads of dimension 128**:

$$
Q \in \mathbb{R}^{1 \times 12 \times 65 \times 128}, \qquad
K, V \in \mathbb{R}^{1 \times 2 \times 65 \times 128}
$$

### 5b. Grouped-Query Attention — why only 2 KV heads

Standard multi-head attention gives every query head its *own* key/value
head. GQA — logged directly for run 1 as
**`num_key_value_heads: 2`** against **12 query heads** — instead
**groups** the 12 query heads into `12 / 2 = 6` groups, and every query
head within a group shares the *same* key/value head:

```
Query heads:  [ 0  1  2  3  4  5 ] [ 6  7  8  9 10 11 ]
                       |                     |
KV head used:      KV head #0           KV head #1
```

Before computing attention scores, each of the 2 KV heads is repeated 6
times (`repeat_kv`) to line up with the 12 query heads, so the actual
score computation still happens per-query-head — GQA is purely a memory
and compute optimization, not a change to what attention *computes*.

**Why this matters in practice**: the K and V tensors that must be
cached for every generated token (Section 8, KV cache) are `2 × 128 =
256`-dimensional per token, not `12 × 128 = 1536`. That's a **6× smaller
KV cache** than full multi-head attention would need, at (empirically,
for well-trained GQA models) negligible quality cost — this is exactly
why a 1.5B-parameter model with a 32,768-token context window is
practical to run at all.

### 5c. RoPE applied here, not earlier

This is the exact point in the computation where Section 3's rotation is
applied — **to $Q$ and $K$ only**, per-head, using each token's absolute
position $m \in \{0, \dots, 64\}$:

$$
Q_{\text{rot}} = \text{RoPE}(Q), \qquad K_{\text{rot}} = \text{RoPE}(K)
$$

$V$ is **not** rotated — RoPE only needs to affect how strongly two
positions' Q and K vectors align (the *score*), not what content gets
mixed in once attention weights are decided.

### 5d. Attention scores, causal masking, softmax

For each of the 12 (post-GQA-expansion) query heads independently:

$$
\text{scores} = \frac{Q_{\text{rot}} K_{\text{rot}}^{T}}{\sqrt{d_k}} \in \mathbb{R}^{1 \times 12 \times 65 \times 65}
$$

with $d_k = 128$, so the scaling factor is $\sqrt{128} \approx 11.31$ —
this scaling keeps dot-product magnitudes from growing with head
dimension and destabilizing softmax gradients.

**Causal masking** — decoder-only models must never let a token attend to
positions *after* itself, otherwise the model could "cheat" by looking at
tokens it's supposed to be predicting. A mask $M$ is added before
softmax:

$$
M_{i,j} = \begin{cases} 0 & j \le i \\ -\infty & j > i \end{cases}
$$

so that for token $i$ (e.g. `apples` at position 28), any position $j >
28$ (anything from `.` at 29 onward, including the entire assistant
turn) gets a score of $-\infty$ and therefore **zero weight** after
softmax. This is what makes the sequence a genuinely *causal*, left-to-
right model — it's also exactly why the same forward pass at position 64
(the last prompt token, right before generation starts) can legitimately
attend to all 65 positions from 0–64 while position 0 (`<|im_start|>`)
can only attend to itself.

$$
\text{Attention}(Q, K, V) = \text{softmax}\left(\frac{QK^T}{\sqrt{d_k}} + M\right) V
$$

The softmax turns each row of masked scores into a probability
distribution over *only the visible positions so far* — this is the
"attention weights" for that query token, one distribution per head, per
query position.

### 5e. Weighted sum, concatenation, output projection

Each head produces a weighted sum of $V$ vectors:

$$
\text{head}_h = \text{softmax}\left(\frac{Q_h K_h^T}{\sqrt{d_k}} + M\right) V_h \in \mathbb{R}^{1 \times 65 \times 128}
$$

All 12 heads' outputs are concatenated back into a single 1536-dim
vector per position, then passed through the output projection:

$$
\text{AttnOut} = \text{Concat}(\text{head}_1, \dots, \text{head}_{12}) \, W_O \in \mathbb{R}^{1 \times 65 \times 1536}
$$

**This is exactly the tensor run 1 logged as `self_attn_out_shape:
[1, 65, 1536]` at every one of the 28 layers.** The shape has returned to
1536 dims per token — the same shape as the residual stream — precisely
so it can be added back in.

---

## 6. Residual connection #1, then the MLP (SwiGLU feed-forward)

$$
H_{\text{mid}} = H^{(l-1)} + \text{AttnOut}
$$

This is the first of two additions per layer. **Attention output doesn't
replace the residual stream — it's added into it.** This additive
structure (confirmed by every layer keeping the same `[1, 65, 1536]`
shape) is exactly what makes techniques like activation patching and
steering vectors work: any vector injected at any layer composes
linearly with whatever was already accumulated.

After a second RMSNorm (`post_attention_layernorm`), the normalized
tensor goes through the **MLP** — logged for every layer as
`mlp_out_shape: [1, 65, 1536]`. Qwen2 uses a **SwiGLU-style
gated MLP** [verified live], not a plain two-layer feed-forward:

$$
\text{MLP}(y) = \big(\text{SiLU}(yW_{\text{gate}}) \odot (yW_{\text{up}})\big) \, W_{\text{down}}
$$

with **[verified live]**:

| Projection | Weight shape | Bias |
|---|---|---|
| `gate_proj` | `[8960, 1536]` | no |
| `up_proj` | `[8960, 1536]` | no |
| `down_proj` | `[1536, 8960]` | no |

The **SiLU** (Sigmoid Linear Unit / "swish") activation used on the gate
path is:

$$
\text{SiLU}(z) = z \cdot \sigma(z) = \frac{z}{1 + e^{-z}}
$$

The MLP's hidden dimension is **8960** [from model config] — roughly
**5.83×** the 1536 hidden size, wider than GPT-2's 4× expansion, which is
typical for gated-MLP architectures (part of the expansion ratio
"budget" goes toward the extra gating projection). $y W_{\text{gate}}$ and
$y W_{\text{up}}$ are each computed at the full 8960-wide intermediate
size, element-wise multiplied (`gate` acts as a learned, input-dependent
"how much of `up`'s signal to let through" mask), then projected back
down to 1536 by `down_proj` — matching the logged `mlp_out_shape:
[1, 65, 1536]`.

$$
H^{(l)} = H_{\text{mid}} + \text{MLP}(y)
$$

— **residual connection #2**, completing one full decoder layer.

This exact `RMSNorm → Attention → residual add → RMSNorm → MLP →
residual add` block is what runs, unchanged in structure, **28 times**
(logged: `num_layers: 28`) to go from $H^{(0)}$ (raw embeddings) to
$H^{(27)}$ — the final hidden state, still shaped `[1, 65, 1536]`.

---

## 7. Final RMSNorm and the LM head — hidden states → logits

After all 28 layers, one more RMSNorm (`model.norm`, same formula as
Section 4a, same $\epsilon = $ 1e-6) is applied to $H^{(27)}$, then
projected onto the vocabulary by the **LM head**:

$$
\text{logits} = \text{RMSNorm}(H^{(27)}) \, W_U \in \mathbb{R}^{1 \times 65 \times 151936}
$$

Run 1's `final_logits` event logged this shape exactly:

```json
{"event": "final_logits", "shape": [1, 65, 151936], "vocab_size": 151936}
```

Because Qwen2.5-1.5B **ties weights** [from model config], $W_U = W_E^T$
— the unembedding matrix is the transpose of the *same* embedding table
from Section 2. This is a real, verifiable architectural fact (not a
simplification): the model spends its 1.54B parameters using one
151,936×1536 matrix for both "text → vector" and "vector → text-score"
duty, rather than learning two.

### 7a. Logit lens — decoding every layer's "current best guess"

Run 1 also computed something the raw forward pass never actually does:
it took **every intermediate layer's** hidden state $H^{(l)}$ and ran it
through the *same* final RMSNorm + LM head early, to see what the model
"would have predicted" if that layer were the last one. This is the
**logit lens** technique, and the results are logged verbatim in run 1's
`logit_lens` event (top predicted next-token, for the *last* position —
i.e. what comes right after `assistant\n`, position 64):

| Layers | Top predicted token | What's happening |
|---|---|---|
| 0–14 (mostly) | `'s'` | Uninformative filler — early layers haven't organized information into a vocabulary-aligned "answer" yet |
| 3 | `'<<<<<<<'` | A genuinely strange, seemingly-random guess — a normal artifact of probing a layer whose representation isn't yet meant to be interpreted this way |
| 15–16 | `' First'` | Model starts converging on *reasoning-opener* vocabulary |
| 17–20 | `'Step'` | Still converging on how to *start* a step-by-step answer |
| 21 | `'Okay'` | Another plausible reasoning-opener |
| 22–27 | `'Let'` | **Locks in** — matches the model's actual final top prediction |

**Grounded interpretation, specific to this run**: the correct final
answer only stabilizes in the **last 6 of 28 layers** (22 onward), and
everything before that is either uninformative or guessing at
semantically-plausible-but-wrong openers for a reasoning answer (`First`,
`Step`, `Okay`) before settling on the model's actual choice, `Let`. This
tells you the bulk of this model's "decision" about *how to begin its
answer* is a late-layer computation — most of the first 21 layers are
doing something else (building up contextual understanding of the
arithmetic problem, most likely), not yet committing to output-token
choices.

### 7b. From logits to probabilities — softmax

The raw logits are converted to a probability distribution over the full
151,936-token vocabulary with softmax:

$$
P(\text{token} = t \mid x_{1:65}) = \frac{e^{\text{logit}_t}}{\sum_{t'=1}^{151936} e^{\text{logit}_{t'}}}
$$

Run 1 logged the **top-5 raw logits** for the last position:

| Token | Logit (logged) |
|---|---|
| `'Let'` | 25.625 |
| `'To'` | 24.5 |
| `'Sure'` | 24.0 |
| `'John'` | 23.75 |
| `'Certainly'` | 21.875 |

Re-running this exact same forward pass and computing the **exact
softmax over the full 151,936-token vocabulary** [verified live] gives:

| Token | Probability |
|---|---|
| `'Let'` | **56.76%** |
| `'To'` | 18.43% |
| `'Sure'` | 11.18% |
| `'John'` | 8.70% |
| `'Certainly'` | 1.33% |

(these top 5 alone already account for **96.4%** of the total probability
mass — the model is quite confident about *how* to open this answer,
picking among a small set of reasonable "reasoning starter" phrases, even
though it hasn't written a single token of the actual answer yet.)

---

## 8. Token selection and the KV cache

### 8a. Greedy decoding

The model's `generation_config` [from model config] specifies
`do_sample: false` — **greedy decoding**: always pick
$\arg\max_t P(t)$. For run 1's last position, that's `'Let'` (56.76%
probability, highest logit) — and this is exactly what the actual
generated response begins with:

> *"**Let's** break down the problem step by step: ..."*

logged verbatim in run 1's `generation` event. Every stage above — 28
layers of attention/MLP, final norm, LM head, softmax — converges on this
one token, and it's directly visible in the model's real output.

### 8b. The KV cache — why generation doesn't redo all 65 tokens' work every step

`use_cache: true` [from model config] means that once $K$ and $V$
(Section 5a) are computed for a given token at a given layer, they're
**stored** rather than recomputed. For step 2 of generation (predicting
the token *after* `Let`), the model doesn't reprocess all 65 original
tokens plus `Let` from scratch — it only computes $Q, K, V$ for the *new*
token, appends the new $K, V$ to the cached tensors from every previous
step, and attends over the full growing sequence using the cache.

This is precisely why Section 5b's GQA-driven KV cache size matters: with
12 full KV heads, the cache at each generation step would store `12 ×
128 = 1536` dims of K and V per token per layer; with **2 KV heads**
(this model), it's only `2 × 128 = 256` — a 6× smaller cache, growing by
one token's worth of K/V at each of the 28 layers on every one of the (up
to) 120 generation steps `max_new_tokens: 120` (logged) run 1 requested.

### 8c. Autoregressive generation, step by step

Putting it together, generating run 1's response is:

1. Forward pass over the 65-token prompt (everything in Sections 1–7)
   → predict token 66: `Let` (greedy, from the softmax in 7b).
2. Append `Let`'s embedding as a new position; forward pass computes
   *only* the new position's $Q, K, V$ at every layer (reusing cached
   $K, V$ for positions 0–65) → predict token 67.
3. Repeat — each new token becomes part of the context for the next
   prediction, and the causal mask (Section 5d) ensures nothing generated
   so far is "seen" out of order.
4. Continue until `max_new_tokens: 120` is reached, or the model emits
   `<|im_end|>` (`eos_token_id: 151645` [from model config]).

Run 1's logged `generation` event is the actual output of that loop
(truncated in the log at 120 new tokens, mid-sentence):

> *"Let's break down the problem step by step: 1. **Initial number of
> apples:** John starts with 3 apples. 2. **Apples bought:** John buys 5
> more apples. Now, we add these to the initial amount: 3 + 5 = 8. 3.
> **Apples given away:** John gives 2 apples to his friend. We subtract
> these from the current total: 8 − 2 = 6. So"*

Notice the model correctly tracked `3 → +5 → 8 → −2 → 6` — a real
multi-step computation carried out entirely through the token-by-token
autoregressive process above, using no external calculator, only
attention over its own previously-generated tokens plus the mechanisms
in Sections 1–7 repeated at every step.

---

## 9. Bonus: proving causal necessity, not just correlation

Everything above describes what the model *computes*. Run 1 also
includes one **causal intervention** — logged in the `causal_intervention`
event — that tests whether a specific piece of that computation actually
*matters*, rather than just being present:

```json
{
  "event": "causal_intervention",
  "ablated_layer": 14,
  "ablation": "zero entire layer output (attention + MLP)",
  "normal_prediction": "Let",
  "ablated_prediction": ",",
  "prediction_changed": true
}
```

This re-ran the exact same forward pass from Sections 1–7, but forcibly
set **layer 14's entire contribution to the residual stream** (both its
attention output *and* its MLP output — Section 6's $H^{(14)} -
H^{(13)}$ term) to zero, before letting layers 15–27 run normally on
top of that damaged residual stream. The result: the top prediction
flipped from `'Let'` to `','` — proof that layer 14's computation is
**causally necessary** for this specific prediction, not merely
correlated with it.

Compare this to a similar experiment on GPT-2 (`inspect_gpt2.py`, layer
5 ablation): GPT-2 broke the same way after a single-layer ablation. What
run 1 additionally established (documented in `README.md`) is that
ablating *only* Qwen's layer-14 self-attention sub-module (not the whole
layer) was **not** enough to change the prediction — this 28-layer model
has enough redundant paths (27 other layers, plus that same layer's MLP)
to route the fact/decision around one missing attention module. It took
removing the *entire* layer's contribution — both sub-layers together —
before the prediction actually broke. That's a genuine, useful negative
result about how redundantly this specific computation is represented in
a deeper model, directly measured, not assumed.

---

## 10. Full pipeline summary (Run 1, concrete shapes throughout)

```
"John has 3 apples. ..."                              (raw user string)
        |  apply_chat_template()
        v
"<|im_start|>system\n...assistant\n"                    (templated string)
        |  BPE tokenizer
        v
[151644, 8948, 198, ..., 198]                          65 token IDs
        |  embedding lookup:  E_i = W_E[x_i]
        v
H^(0)                                                   [1, 65, 1536]
        |
        |  ====== repeat 28 times (layers 0-27) ======
        |  RMSNorm -> Q,K,V proj (12 Q-heads, 2 KV-heads)
        |  -> RoPE(Q,K) -> GQA-expand KV -> scores/mask/softmax -> V-weighted sum
        |  -> o_proj -> self_attn_out [1, 65, 1536]
        |  -> residual add #1
        |  RMSNorm -> gate/up proj (8960) -> SiLU-gate -> down_proj
        |  -> mlp_out [1, 65, 1536]
        |  -> residual add #2
        v  (repeat ...)
H^(27)                                                  [1, 65, 1536]
        |  final RMSNorm
        |  LM head (W_U = W_E^T, tied weights)
        v
logits                                                  [1, 65, 151936]
        |  softmax (last position)
        v
P(next token)      'Let' 56.76%, 'To' 18.43%, 'Sure' 11.18%, ...
        |  argmax (greedy decoding, do_sample=False)
        v
"Let"  -->  append, repeat autoregressively (KV cache reused)  -->  ...
        v
"Let's break down the problem step by step: ... 8 - 2 = 6. So"   (full response, logged)
```

---

## Where to go next

- `README.md` — how to re-run this experiment yourself, and the same
  walkthrough's GPT-2 counterpart (a LayerNorm/learned-positional-
  embedding/full-multi-head-attention model, useful as a contrast to
  every RMSNorm/RoPE/GQA detail above).
- `logger/logs/inspect_qwen.json` — the raw run 1 data this document is
  built from, plus every other run of this script (never overwritten).
- `nnsight:logit-lens`, `nnsight:activation-patching`,
  `nnsight:causal-tracing` — skills covering Sections 7a and 9 in more
  depth, including how to localize *which* attention head or neuron
  (not just which whole layer) is responsible for a given behavior.