# Deterministic Local Model Fixtures

`qwen35-template.txt` is the public `tokenizer.chat_template` metadata extracted from the consented [Qwen3.5-9B Q4_K_M artifact](https://huggingface.co/unsloth/Qwen3.5-9B-GGUF/tree/3885219b6810b007914f3a7950a8d1b469d598a5), under Apache-2.0 (Qwen/Alibaba Cloud; conversion by Unsloth). The [license](LICENSE-APACHE-2.0) is retained. Its SHA-256 is `7f0e529032c25183bcd66c7f238da2d377f43be754a94e2725a58c4e16d2ed67`. It contains no weights or user input and lets the fake runtime satisfy the production template pin.

The PDF fixture builder uses the pinned PDF.js build dependency's SIL-OFL Liberation font and its bundled license, not system fonts or temporary model assets. It creates synthetic bytes during tests; production ships only the separately verified parser closure and Apache license.
