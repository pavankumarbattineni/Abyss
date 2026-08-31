"""
NNSight walkthrough: inspecting a transformer's internals end-to-end.

Why GPT-2 and not GPT-5:
    NNSight works by wrapping an actual PyTorch model object and hooking into
    its forward pass. That requires the model's weights and architecture to
    be loadable in-process (or served remotely via NDIF for huge open-weight
    models like Llama-70B/405B). GPT-5 is closed-weight and only reachable
    through Anthropic's/OpenAI's hosted inference API -- there is no local
    nn.Module to attach to, so NNSight (or any other white-box interpretability
    tool) cannot inspect it. This script uses GPT-2 (openai-community/gpt2),
    a small open-weight transformer, so every stage below is something you
    could point at any other open-weight model (Llama, Mistral, Gemma, ...)
    with the same code, just a different `model_name`.

Every stage of this run is written to logger/logs/ -- see
logger/experiment_logger.py -- as both a human-readable .log file and a
structured .jsonl file for later review/analysis.

Run with:  python3 inspect_gpt2.py
"""

import torch
from nnsight import LanguageModel

from logger.experiment_logger import ExperimentLogger

MODEL_NAME = "openai-community/gpt2"
PROMPT = "What is Capital city of India?"


def unwrap_hidden(block_output):
    # Some transformers versions return (hidden_state, *extras) from a
    # decoder block's forward(); others return the hidden_state tensor
    # directly. Handle both so this script is version-robust.
    return block_output[0] if isinstance(block_output, (tuple, list)) else block_output


def main():
    log = ExperimentLogger(model_name=MODEL_NAME, script_name="inspect_gpt2", prompt=PROMPT)

    try:
        # ------------------------------------------------------------------
        # STAGE 0: Load the model
        # ------------------------------------------------------------------
        model = LanguageModel(MODEL_NAME, device_map="cpu", dispatch=True)
        log.event(
            "model_loaded",
            model=MODEL_NAME,
            num_layers=len(model.transformer.h),
            hidden_size=model.config.n_embd,
            num_heads=model.config.n_head,
            vocab_size=model.config.vocab_size,
        )

        # ------------------------------------------------------------------
        # STAGE 1: Tokenization
        # ------------------------------------------------------------------
        log.section("STAGE 1: Tokenization")
        tokens = model.tokenizer(PROMPT)["input_ids"]
        token_strs = [model.tokenizer.decode([t]) for t in tokens]
        log.event(
            "tokenization",
            prompt=PROMPT,
            num_tokens=len(tokens),
            token_ids=tokens,
            token_strings=token_strs,
        )

        # ------------------------------------------------------------------
        # STAGE 2-5: One trace captures embeddings, every layer's attention/
        # MLP/hidden state, and the final logits, all from a single forward pass.
        # ------------------------------------------------------------------
        with model.trace(PROMPT):
            token_embeddings = model.transformer.wte.output.save()

            attn_outputs = list().save()
            mlp_outputs = list().save()
            raw_block_outputs = list().save()
            for layer in model.transformer.h:
                attn_outputs.append(layer.attn.output[0].save())
                mlp_outputs.append(layer.mlp.output.save())
                raw_block_outputs.append(layer.output)

            logits = model.lm_head.output.save()

        hidden_states = [unwrap_hidden(raw) for raw in raw_block_outputs]
        block_output_is_tuple = isinstance(raw_block_outputs[0], (tuple, list))

        # ------------------------------------------------------------------
        # STAGE 2 (report): Embeddings
        # ------------------------------------------------------------------
        log.section("STAGE 2: Token embeddings")
        log.event("embeddings", shape=list(token_embeddings.shape))

        # ------------------------------------------------------------------
        # STAGE 3 (report): Layer-by-layer hidden states, attention, MLP
        # ------------------------------------------------------------------
        log.section("STAGE 3: Per-layer internals")
        layer_shapes = []
        for i, (attn, mlp, hidden) in enumerate(zip(attn_outputs, mlp_outputs, hidden_states)):
            layer_shapes.append(
                {
                    "layer": i,
                    "attn_out_shape": list(attn.shape),
                    "mlp_out_shape": list(mlp.shape),
                    "residual_stream_shape": list(hidden.shape),
                }
            )
        log.event("layer_shapes", block_output_is_tuple=block_output_is_tuple, layers=layer_shapes)

        # ------------------------------------------------------------------
        # STAGE 4: Logit Lens -- decode what each layer "would predict"
        # ------------------------------------------------------------------
        log.section("STAGE 4: Logit lens -- top predicted next-token per layer")
        logit_lens = []
        for i, hidden in enumerate(hidden_states):
            normed = model.transformer.ln_f(hidden)
            layer_logits = model.lm_head(normed)
            top_token = layer_logits[0, -1].argmax()
            decoded = model.tokenizer.decode(top_token)
            logit_lens.append({"layer": i, "top_token": decoded})
            log.info(f"  After layer {i:2d}: {decoded!r}")
        log.event("logit_lens", predictions=logit_lens)

        # ------------------------------------------------------------------
        # STAGE 5 (report): Final logits
        # ------------------------------------------------------------------
        log.section("STAGE 5: Final logits")
        top5 = torch.topk(logits[0, -1], 5)
        top5_candidates = [
            {"token": model.tokenizer.decode(idx), "logit": round(score, 3)}
            for score, idx in zip(top5.values.tolist(), top5.indices.tolist())
        ]
        log.event(
            "final_logits",
            shape=list(logits.shape),
            vocab_size=model.config.vocab_size,
            top5=top5_candidates,
        )

        # ------------------------------------------------------------------
        # STAGE 6: Token-by-token autoregressive generation trace
        # ------------------------------------------------------------------
        # This loop uses a REAL KV cache (HF's `past_key_values`, passed
        # explicitly between trace() calls) -- exactly what production
        # inference does. Step 1 processes the full prompt; every step
        # after that feeds ONLY the newest token, reusing cached keys/
        # values for everything before it -- so cost per step stays flat
        # instead of growing with context length, which is what makes it
        # practical to run with no artificial cap. Every layer's shapes
        # are still fully captured at every step. The KV cache SIZE logged
        # per step is read directly off the real cache object, not
        # estimated.
        #
        # No token limit: generation runs until the model emits its own
        # EOS token, or until this model's actual context window
        # (`n_positions`, GPT-2-small's real architectural limit) is hit.
        eos_ids = model.generation_config.eos_token_id
        if eos_ids is None:
            eos_ids = []
        elif isinstance(eos_ids, int):
            eos_ids = [eos_ids]

        max_context_len = model.config.n_positions  # GPT-2-small's real context window (1024)
        log.section(
            f"STAGE 6: Token-by-token generation (until EOS, "
            f"or the {max_context_len}-token context limit is reached)"
        )

        generated_ids = []
        past_key_values = None
        step = 0

        while True:
            step += 1
            context_len_before = len(tokens) + len(generated_ids)
            # First step processes the whole prompt; every step after
            # feeds only the token generated in the previous step -- the
            # cache supplies everything before it.
            step_input_ids = tokens if past_key_values is None else [generated_ids[-1]]

            # CRITICAL: when reusing a KV cache, the new token's absolute
            # position and the full attention mask must be passed
            # EXPLICITLY. Without this, a single-new-token forward pass
            # silently defaults to position 0 and a length-1 mask instead
            # of "position = context_len_before" and "mask covering the
            # whole cached + new sequence" -- corrupting positional
            # embeddings/RoPE and the causal mask from step 2 onward, and
            # visibly degrading generation quality (verified: this alone
            # was enough to make GPT-2 collapse into an infinite '\n'
            # loop instead of producing real text).
            if past_key_values is None:
                position_ids = torch.arange(len(tokens)).unsqueeze(0)
                attention_mask = torch.ones((1, len(tokens)), dtype=torch.long)
            else:
                position_ids = torch.tensor([[context_len_before]])
                attention_mask = torch.ones((1, context_len_before + 1), dtype=torch.long)

            # torch.no_grad() is essential here too: without it, each step's
            # past_key_values tensors carry a grad_fn back through every
            # prior step's computation graph, so nothing from earlier
            # steps is ever freed and memory grows without bound over a
            # long generation run.
            with torch.no_grad(), model.trace(
                step_input_ids,
                past_key_values=past_key_values,
                use_cache=True,
                position_ids=position_ids,
                attention_mask=attention_mask,
            ):
                step_attn = list().save()
                step_mlp = list().save()
                step_raw_layers = list().save()
                for layer in model.transformer.h:
                    step_attn.append(layer.attn.output[0].save())
                    step_mlp.append(layer.mlp.output.save())
                    step_raw_layers.append(layer.output)
                step_output = model.output.save()

            step_logits = step_output.logits
            past_key_values = step_output.past_key_values

            step_hidden = [unwrap_hidden(r) for r in step_raw_layers]
            layer_records = [
                {
                    "layer": i,
                    "attn_out_shape": list(a.shape),
                    "mlp_out_shape": list(m.shape),
                    "residual_stream_shape": list(h.shape),
                }
                for i, (a, m, h) in enumerate(zip(step_attn, step_mlp, step_hidden))
            ]

            last_logits = step_logits[0, -1].float()
            probs = torch.softmax(last_logits, dim=-1)
            top5 = torch.topk(probs, 5)
            top5_candidates = [
                {"token_id": idx, "token": model.tokenizer.decode(idx), "probability": round(p, 6)}
                for p, idx in zip(top5.values.tolist(), top5.indices.tolist())
            ]
            # Greedy decoding (this model's generation_config has do_sample=False),
            # so the SELECTED token is simply the top candidate -- distinct from,
            # but consistent with, the top5_candidates list above.
            selected_id = top5.indices[0].item()
            selected_token = model.tokenizer.decode(selected_id)

            # Real KV cache size, read directly from the cache object (not
            # an estimate): sum of every layer's actual key + value tensor.
            kv_cache_bytes = sum(
                k.element_size() * k.nelement() + v.element_size() * v.nelement()
                for k, v in (past_key_values[i] for i in range(len(past_key_values)))
            )

            log.info(f"Generation Step {step}")
            log.info(f"  Context so far ({context_len_before} tokens): {model.tokenizer.decode(tokens + generated_ids)!r}")
            log.info(f"  This step's forward pass: {len(step_input_ids)} new token(s) (rest served from KV cache)")
            log.info("  Top-5 candidates:")
            for c in top5_candidates:
                log.info(f"    {c['token']!r:12s} -> {c['probability']:.4f}")
            log.info(f"  Selected token: {selected_token!r}")

            log.event(
                "generation_step",
                step=step,
                context_num_tokens=context_len_before,
                step_input_num_tokens=len(step_input_ids),
                context_text=model.tokenizer.decode(tokens + generated_ids),
                final_hidden_state_shape=layer_records[-1]["residual_stream_shape"],
                logits_shape=list(step_logits.shape),
                layers=layer_records,
                top5_candidates=top5_candidates,
                selected_token_id=selected_id,
                selected_token=selected_token,
                kv_cache_bytes=kv_cache_bytes,
            )

            generated_ids.append(selected_id)

            if selected_id in eos_ids:
                log.info(f"  Step {step}: hit EOS token, stopping generation")
                break
            if context_len_before + 1 >= max_context_len:
                log.info(f"  Step {step}: reached the {max_context_len}-token context limit, stopping generation")
                break

        continuation = model.tokenizer.decode(generated_ids)
        full_text = model.tokenizer.decode(tokens + generated_ids)
        stopped_reason = "eos_token" if generated_ids and generated_ids[-1] in eos_ids else "context_limit_reached"
        log.event(
            "generation",
            continuation=continuation,
            full_text=full_text,
            max_context_len=max_context_len,
            num_steps=len(generated_ids),
            stopped_reason=stopped_reason,
        )

        # ------------------------------------------------------------------
        # BONUS: Causal intervention -- prove a layer matters, don't just
        # observe it. Zero out a middle layer and see the prediction break.
        # ------------------------------------------------------------------
        log.section("BONUS: Causal intervention (ablating layer 5)")
        with model.trace(PROMPT):
            if block_output_is_tuple:
                model.transformer.h[5].output[0][:, :, :] = 0
            else:
                model.transformer.h[5].output[:, :, :] = 0
            ablated_logits = model.lm_head.output.save()

        normal_top = model.tokenizer.decode(logits[0, -1].argmax())
        ablated_top = model.tokenizer.decode(ablated_logits[0, -1].argmax())
        log.event(
            "causal_intervention",
            ablated_layer=5,
            ablation="zero entire layer output",
            normal_prediction=normal_top,
            ablated_prediction=ablated_top,
            prediction_changed=normal_top != ablated_top,
        )
    except Exception as exc:
        log.error(f"Run failed: {exc!r}")
        raise
    finally:
        log.close()


if __name__ == "__main__":
    main()
