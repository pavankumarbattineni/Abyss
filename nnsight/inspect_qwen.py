"""
NNSight walkthrough #2: inspecting a modern, small decoder-only LLM.

Model choice: Qwen2.5-1.5B-Instruct
    - Decoder-only transformer (same family as Llama, DeepSeek, GPT).
    - 1.5B parameters -- small enough to load and trace on a CPU-only
      laptop with a few GB of free RAM (loaded in bfloat16, ~3GB).
    - Publicly downloadable from HuggingFace with no gating/license
      click-through (unlike Llama, which requires requesting access).
      DeepSeek's smallest *dense* open checkpoints are also gated or
      much larger; Qwen2.5-1.5B is the most frictionless small,
      modern, instruction-tuned decoder-only model to experiment with.
    - Same architecture family as Llama/DeepSeek's dense layers: RMSNorm,
      SwiGLU MLP, rotary position embeddings (RoPE), grouped-query
      attention -- so the module names used here
      (`model.layers[i].self_attn` / `.mlp` / `.input_layernorm`) are the
      same ones you'd use to point this exact code at
      "meta-llama/Llama-3.2-3B-Instruct" or "Qwen/Qwen2.5-3B-Instruct"
      once you have HF access to those.

This mirrors inspect_gpt2.py but on a real, current instruction-tuned
model, including a chat template (the way you'd actually prompt it).

Every stage of this run is written to logger/logs/ -- see
logger/experiment_logger.py -- as both a human-readable .log file and a
structured .jsonl file for later review/analysis.

Run with:  python3 inspect_qwen.py
"""

import torch
from nnsight import LanguageModel

from logger.experiment_logger import ExperimentLogger

MODEL_NAME = "Qwen/Qwen2.5-1.5B-Instruct"
# The token-by-token generation trace (STAGE 6) re-traces the FULL growing
# context at every step (no KV-cache reuse -- see that stage's comment),
# so on CPU this is noticeably slower per token than a normal generate()
# call. There is deliberately NO fixed token cap here: generation runs
# until the model emits its own EOS token, or until this model's actual
# context window (32,768 tokens) is reached -- whichever comes first.
# Expect a run to take longer than earlier, capped versions of this
# script; run it in the background if you don't want to wait inline.
USER_PROMPT = (
    "John has 3 apples. He buys 5 more apples and gives 2 apples to his "
    "friend. How many apples does John have now? Explain your reasoning "
    "step by step."
)


def unwrap_hidden(block_output):
    # Some transformers versions return (hidden_state, *extras) from a
    # decoder layer's forward(); others return the hidden_state tensor
    # directly. Handle both so this script is version-robust.
    return block_output[0] if isinstance(block_output, (tuple, list)) else block_output


def main():
    log = ExperimentLogger(model_name=MODEL_NAME, script_name="inspect_qwen", prompt=USER_PROMPT)

    try:
        # ------------------------------------------------------------------
        # STAGE 0: Load the model
        # ------------------------------------------------------------------
        # bfloat16 keeps this to ~3GB of RAM instead of ~6GB in float32 --
        # important for running a 1.5B-parameter model on a laptop CPU.
        model = LanguageModel(
            MODEL_NAME,
            device_map="cpu",
            torch_dtype=torch.bfloat16,
            dispatch=True,
        )
        log.event(
            "model_loaded",
            model=MODEL_NAME,
            num_layers=len(model.model.layers),
            hidden_size=model.config.hidden_size,
            num_attention_heads=model.config.num_attention_heads,
            num_key_value_heads=model.config.num_key_value_heads,
            vocab_size=model.config.vocab_size,
        )

        # ------------------------------------------------------------------
        # STAGE 1: Tokenization -- via the model's chat template
        # ------------------------------------------------------------------
        log.section("STAGE 1: Tokenization")
        messages = [{"role": "user", "content": USER_PROMPT}]
        prompt_text = model.tokenizer.apply_chat_template(
            messages, tokenize=False, add_generation_prompt=True
        )
        tokens = model.tokenizer(prompt_text)["input_ids"]
        log.event(
            "tokenization",
            user_message=USER_PROMPT,
            num_tokens=len(tokens),
            prompt_with_chat_template=prompt_text,
        )

        # ------------------------------------------------------------------
        # STAGE 2-5: One trace captures embeddings, every layer's attention/
        # MLP/hidden state, and the final logits, all from a single forward pass.
        # ------------------------------------------------------------------
        with model.trace(prompt_text):
            token_embeddings = model.model.embed_tokens.output.save()

            attn_outputs = list().save()
            mlp_outputs = list().save()
            raw_layer_outputs = list().save()
            for layer in model.model.layers:
                attn_outputs.append(layer.self_attn.output[0].save())
                mlp_outputs.append(layer.mlp.output.save())
                raw_layer_outputs.append(layer.output)

            logits = model.lm_head.output.save()

        hidden_states = [unwrap_hidden(raw) for raw in raw_layer_outputs]
        layer_output_is_tuple = isinstance(raw_layer_outputs[0], (tuple, list))

        # ------------------------------------------------------------------
        # STAGE 2 (report): Embeddings
        # ------------------------------------------------------------------
        log.section("STAGE 2: Token embeddings")
        log.event("embeddings", shape=list(token_embeddings.shape))

        # ------------------------------------------------------------------
        # STAGE 3 (report): Per-layer attention, MLP, residual stream
        # ------------------------------------------------------------------
        log.section("STAGE 3: Per-layer internals")
        layer_shapes = []
        for i, (attn, mlp, hidden) in enumerate(zip(attn_outputs, mlp_outputs, hidden_states)):
            layer_shapes.append(
                {
                    "layer": i,
                    "self_attn_out_shape": list(attn.shape),
                    "mlp_out_shape": list(mlp.shape),
                    "residual_stream_shape": list(hidden.shape),
                }
            )
        log.event("layer_shapes", layer_output_is_tuple=layer_output_is_tuple, layers=layer_shapes)

        # ------------------------------------------------------------------
        # STAGE 4: Logit lens -- decode each layer's "current best guess"
        # ------------------------------------------------------------------
        # Qwen2's final norm is RMSNorm (`model.model.norm`), applied before
        # the un-embedding (`lm_head`) -- same trick as GPT-2's ln_f, just a
        # different normalization implementation.
        log.section("STAGE 4: Logit lens -- top predicted next-token per layer")
        logit_lens = []
        for i, hidden in enumerate(hidden_states):
            normed = model.model.norm(hidden)
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
        top5 = torch.topk(logits[0, -1].float(), 5)
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
        # after that feeds ONLY the newest token, reusing cached GQA
        # keys/values (only 2 key/value heads' worth per layer -- see
        # QWEN_RUN1_TRANSFORMER_WALKTHROUGH.md) for everything before it.
        # Cost per step stays flat instead of growing with context length,
        # which is what makes it practical to run with no artificial cap.
        # Every layer's shapes are still fully captured at every step. The
        # KV cache SIZE logged per step is read directly off the real
        # cache object, not estimated.
        #
        # No token limit: generation runs until the model emits its own
        # EOS token, or until this model's actual context window
        # (`max_position_embeddings`, Qwen2.5's real architectural limit
        # of 32,768 tokens) is hit.
        eos_ids = model.generation_config.eos_token_id
        if eos_ids is None:
            eos_ids = []
        elif isinstance(eos_ids, int):
            eos_ids = [eos_ids]

        max_context_len = model.config.max_position_embeddings  # Qwen2.5's real context window (32768)
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
            # whole cached + new sequence" -- corrupting RoPE and the
            # causal mask from step 2 onward. Verified directly: without
            # this fix, Qwen's step-2 prediction after "What is the
            # capital of France?" was near-random noise ('\n' at 28%
            # confidence); with it, it matches a from-scratch full
            # recompute almost exactly (' capital' at ~98-99.99%).
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
                for layer in model.model.layers:
                    step_attn.append(layer.self_attn.output[0].save())
                    step_mlp.append(layer.mlp.output.save())
                    step_raw_layers.append(layer.output)
                step_output = model.output.save()

            step_logits = step_output.logits
            past_key_values = step_output.past_key_values

            step_hidden = [unwrap_hidden(r) for r in step_raw_layers]
            layer_records = [
                {
                    "layer": i,
                    "self_attn_out_shape": list(a.shape),
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
            # This will come out ~6x smaller than a non-GQA model's cache
            # at the same context length and layer count.
            kv_cache_bytes = sum(
                k.element_size() * k.nelement() + v.element_size() * v.nelement()
                for k, v in (past_key_values[i] for i in range(len(past_key_values)))
            )

            context_text_tail = model.tokenizer.decode((tokens + generated_ids)[-25:])
            log.info(f"Generation Step {step}")
            log.info(f"  Context so far ({context_len_before} tokens, last part): ...{context_text_tail!r}")
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
                context_text_tail=context_text_tail,
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

        response = model.tokenizer.decode(generated_ids, skip_special_tokens=True)
        stopped_reason = "eos_token" if generated_ids and generated_ids[-1] in eos_ids else "context_limit_reached"
        log.event(
            "generation",
            response=response,
            max_context_len=max_context_len,
            num_steps=len(generated_ids),
            stopped_reason=stopped_reason,
        )

        # ------------------------------------------------------------------
        # BONUS: Causal intervention -- ablate a whole middle decoder layer
        # (attention + MLP's combined contribution to the residual stream)
        # and watch the prediction change.
        #
        # Note: ablating ONLY that layer's self-attention sub-module is not
        # enough to move this particular prediction -- a 28-layer model has
        # enough redundant paths (other layers, the MLP at the same layer)
        # to route a well-represented fact around a single knocked-out
        # attention module. That's a real, useful negative result: it shows
        # this computation is redundantly represented, unlike GPT-2-small's
        # much shallower, more fragile computation (see inspect_gpt2.py,
        # where zeroing one whole layer *does* flip the answer). To see an
        # effect here we zero out the layer's entire output -- attention
        # AND MLP -- which removes everything that layer contributes to
        # the residual stream.
        # ------------------------------------------------------------------
        ablate_layer = len(model.model.layers) // 2
        log.section(f"BONUS: Causal intervention (zeroing layer {ablate_layer}'s entire output)")
        with model.trace(prompt_text):
            if layer_output_is_tuple:
                model.model.layers[ablate_layer].output[0][:, :, :] = 0
            else:
                model.model.layers[ablate_layer].output[:, :, :] = 0
            ablated_logits = model.lm_head.output.save()

        normal_top = model.tokenizer.decode(logits[0, -1].argmax())
        ablated_top = model.tokenizer.decode(ablated_logits[0, -1].argmax())
        log.event(
            "causal_intervention",
            ablated_layer=ablate_layer,
            ablation="zero entire layer output (attention + MLP)",
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
