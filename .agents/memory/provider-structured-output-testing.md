---
name: Provider structured-output route testing
description: Testing discipline for apps that use one LLM provider across multiple structured-output routes.
---

Test each provider-backed route and its final API response contract independently. A successful response from one schema does not confirm that other schemas or response adapters are correct.

**Why:** A live analytics request succeeded while visitor-draft generation exposed a separate response-shape mismatch.

**How to apply:** When adding multiple structured-output features, exercise every route and validate its complete response schema; keep provider credentials and raw error bodies out of logs.