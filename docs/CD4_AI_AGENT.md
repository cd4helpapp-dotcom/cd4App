# CD4 AI Agent

How the assistant inside the CD4 app works, why it is built this way, and how to run and change it.

CD4 AI answers in three places: text chat (`chat-ai`), voice (`voice-realtime-session`, `voice-realtime-tools`) and report chat (`medical-report-chat`). All three share the code in `supabase/functions/_shared/agent/`.

## How one chat message is handled

Only what needs no thought is fixed text: greetings and emergencies. Everything else is understood by a small AI step that reads the message and recent turns, so typos, Hinglish and voice-to-text mistakes work without a keyword list. Keyword rules remain only as a backup for when that step is slow or fails.

```
Patient message
  │
  ├─ Greeting, thanks or goodbye?                     → fixed reply   no model, no quota
  ├─ Same general question asked before?              → cached reply  no model, no quota
  ├─ Understand it (small AI step, about Rs 0.01)     → intent, city, specialty, stakes
  ├─ Internal data or prompt injection?               → fixed reply   no main model, no quota
  ├─ Similar general question asked before?           → cached reply
  │
  ├─ Daily quota check
  ├─ Retrieve: CD4 knowledge, plus this patient's own records if the question is about them
  ├─ Pick a model: cheap for routine, stronger for high stakes
  ├─ Call the model, with fallbacks
  ├─ Check the reply: vendor names, prompt leaks, values not found in the records
  ├─ Save to the cache if general and low risk
  └─ Log one telemetry row
```

## Identity

`agent/persona.ts` is the one definition of who the assistant is, and every surface starts its prompt with it.

- **Name:** CD4 AI, in every language. The old names ("CD4 Assistant", "CD4 Medical Report Assistant", "CD4 AI Voice Assistant") are gone.
- **Tone:** warm, calm, plain words, "aap" in Hindi, no scripted lines.
- **Technology stays private:** asked which model or company is behind it, it says it is CD4 AI and cannot share technical details. It neither confirms nor denies a guess. `guards.scrubOutput` also removes vendor names from replies as a second layer.

Two limits are deliberate:

- **It never denies being an AI.** Asked "are you human?" or "are you a doctor?", it says it is an AI and not a doctor. Claiming otherwise would mislead patients about medical advice.
- **The privacy policy still names providers.** Patients have a right to know who processes their health data, so Supabase, OpenAI, Google and others stay listed there. The chat keeps the technology private; the legal page does not. This is a business and legal decision to confirm with a lawyer, especially under India's DPDP Act.

## No cost for "hi"

`agent/smallTalk.ts` answers from fixed text in English, Roman Hindi, Hindi and Tamil when the whole message is small talk.

- "hi", "namaste", "thanks" and "bye" get a free reply and do not use the patient's daily messages. Anything that needs thought, such as "who are you", goes to the AI.
- "hi my head hurts" is not small talk, so it goes to the model.
- "ok" is free only at the start of a chat. Mid-conversation it may be answering a question, so it goes to the model.

Voice is different: a voice session is billed for audio once it starts, so a spoken "hello" does cost money. Voice sessions are limited by the daily session quota instead.

## Guardrails

| Stage | What it does | Where |
|---|---|---|
| Input | Blocks instruction overrides, prompt extraction, role changes, jailbreak terms, fake system messages and requests for other patients' data, in English, Roman Hindi and Hindi. Normalises tricks such as zero-width characters and "ign0re". | `guards.detectPromptInjection` |
| Input | Blocks questions about users, revenue, staff and internals. | `INTERNAL_INFO_PATTERN` in `chat-ai` |
| Input | Detects emergencies, marks them high priority and routes to the stronger model. | `detectEmergencySignal`, `CLINICAL_BRAIN_RULES` |
| Scope | The model marks anything unrelated to health as out of scope, and the patient gets a fixed redirect. | `decision.isMedical` |
| Retrieved text | Reports and knowledge are wrapped in `<untrusted_data>`. The prompt says this is information, never instructions, so a report that says "ignore your rules" is just text on a page. | `guards.wrapUntrusted` |
| Output | Removes vendor names. A reply containing prompt text is replaced entirely. | `guards.scrubOutput` |
| Output | Finds lab values and doses that are not in the patient's records, and tells the patient to check them against the original. | `guards.findUnsupportedValues` |
| Actions | The AI cannot confirm a booking. It only opens the payment screen for a slot the patient chose. | `prepareSlotForPayment` |

A false positive only sends a polite refusal, so the patterns lean towards blocking, with one exception: questions about a doctor's instructions or medicines are let through ("should I ignore my doctor's previous instructions?").

**Pattern matching is not complete protection.** A determined attacker can word a new attack. That is why the protection is layered, and why the things that matter most do not depend on the model at all: a patient's token can only reach that patient's data, and only `finalize_appointment_payment` can create a booking.

## RAG

### What gets retrieved

| Source | Table | Who it is for |
|---|---|---|
| How CD4 works: booking, refunds, reports, privacy | `ai_knowledge_chunks` (`app_help`) | Everyone |
| Reviewed medical knowledge | `ai_knowledge_chunks` (`medical`) | Everyone, once loaded |
| The patient's reports and prescriptions | `medical_report_chunks` | Only that patient |
| The patient's upcoming appointments | `appointments`, read live | Only that patient |

### Chunking

Small chunks keep one fact per chunk, so a search returns the answer rather than a whole page around it.

- **Knowledge files:** split on headings first, then to about 800 characters (about 200 tokens) with 100 characters of overlap, ending on a sentence. See `scripts/knowledge-chunker.mjs`.
- **Each chunk starts with its topic,** such as `Booking and payments on CD4 > Cancel a consultation`. Without it, "you can cancel up to 2 hours before" could match the wrong question.
- **Reports:** 700 characters with 120 overlap, up to 60 per report. Reports read before this change keep their older, larger chunks until re-analysed.

### Search

Search is hybrid, because each method misses things the other finds. Vectors match meaning ("sugar" and "glucose"). Keywords match exact terms ("HbA1c", "CBC") that embeddings can blur. The two result lists are combined with reciprocal rank fusion in `match_ai_knowledge` and `match_report_chunks_hybrid`.

Weak matches are dropped (`MIN_KNOWLEDGE_SCORE`, `MIN_REPORT_SCORE`), because an off-topic chunk invites an off-topic answer.

Embeddings use `text-embedding-3-small` at 1536 dimensions, the same model already used for reports.

### Avoiding made-up answers

1. Answers about CD4 and about the patient's own records must come only from retrieved text. If the answer is not there, the prompt tells the model to say so.
2. Report chat receives the passages related to the question, so long reports no longer lose everything past the 8,000 character limit. Before this change, report chunks were written but never read.
3. Numbers are checked against the source after the reply is written.
4. The prompt forbids inventing doctors, appointments, values, studies or statistics.

**What this does not guarantee:** no system can promise zero hallucination. The number check only covers values with units such as `mg/dl`. It does not catch a wrong sentence with no number in it. Medical answers currently come from the model's general knowledge, not from sources (see Medical knowledge below). That is why every medical answer still points the patient to a doctor.

### Adding knowledge

All of this runs from the CLI, using your `npx supabase login`. No key has to be pasted.

| Step | Command |
|---|---|
| 1. Add or edit a Markdown file in `supabase/knowledge/` | |
| 2. See how it will be split, nothing is sent | `npm run ingest:knowledge -- --dry-run` |
| 3. Make it live | `npm run ingest:knowledge` |
| 4. Check what is live, and what is waiting for a doctor | `npm run knowledge:status` |
| 5. Test what a question finds | `npm run knowledge:search -- "dengue me kaunsi dawai nahi leni"` |

Unchanged chunks are skipped, so only edited text pays for embeddings. If a question finds nothing useful in step 5, that topic is missing, so add it.

**When a rule changes in the app, such as the refund window, change the knowledge file too,** or the assistant will give the old answer.

### Medical knowledge

`supabase/knowledge/medical/` is empty on purpose. Text there reaches patients as fact, so it should come from trusted sources (ICMR, MoHFW, WHO, CDSCO) and be checked by a clinician. The ingest script refuses a medical file without `reviewed_by`, `reviewed_on` and `reference`. Loading it is the biggest remaining step towards grounded medical answers.

## Role-based access

`agent/access.ts` decides what the agent may read. Three rules matter:

- **The role comes from the database,** never from the app or from `user_metadata`.
- **The patient id comes from the signed-in token.** No tool accepts a patient id from the model or the request, so "show me Rahul's report" has no way to reach Rahul's data.
- **Records load only when the question is about them.** "What is a CBC test?" reads nothing personal.

| Capability | Patient | Doctor | Hospital | Admin |
|---|---|---|---|---|
| Search CD4 knowledge | Yes | Yes | Yes | Yes |
| Search doctors | Yes | Yes | No | Yes |
| Start a booking | Yes | No | No | No |
| Own appointments | Yes | No | No | No |
| Own reports | Yes | No | No | No |

Voice tools go through the same table, and a refused call is logged as `rbac_denied`. The search functions cannot be called from the app, only with the service key.

## Caching

| Layer | What it saves | When it applies |
|---|---|---|
| Exact | The whole model call | Same general question, same language |
| Semantic | The whole model call, for the price of one embedding | Same meaning, at least 0.95 similar |
| Provider prompt cache | Part of the input price | Automatic for long repeated prefixes |

**A health answer must never reach the wrong person,** so a question is cached only if all of these hold:

- It is the first message of the chat, under the general concern.
- It says nothing about the person: no "I", "my", "mujhe", "मेरा", and no numbers.
- The model marked it educational, with low risk and no doctor recommendation.
- It is not about CD4 itself, since those answers should follow the knowledge files.
- No guard changed the reply.

So "what are the symptoms of dengue?" is cached, and "I have dengue symptoms" is not. Entries expire after 30 days.

The 0.95 threshold is deliberately high: "symptoms of dengue" and "symptoms of malaria" are similar sentences with different answers. Check real hit quality before lowering it.

For the provider's cache, the fixed instructions are now sent first and the per-turn details in a separate message, because only an identical prefix gets the discount. The savings appear in `cached_tokens`.

## Model routing

`agent/router.ts` picks the cheapest model that is safe for the message.

| Situation | Tier | Why |
|---|---|---|
| Routine question | Fast (`CHAT_AI_FAST_MODEL`) | Good enough and cheap |
| Emergency signal | Quality (`CHAT_AI_QUALITY_MODEL`) | A mistake is costly |
| Dose, pregnancy, children, cancer, self-harm, bleeding | Quality | High stakes |
| The patient's own records | Quality | Must quote values exactly |
| Long message, or 4+ turns of history | Quality | More to keep track of |

If a model fails, the request moves down the list, then to Gemini. Each row in telemetry records the tier and the reason.

## Observability

`ai_agent_events` has one row per request: route, model, tokens, cost, latency, cache result, chunks retrieved, top score, guard flags and errors. **It never stores the message or the reply,** because those are health data. Only admins can read it.

The `ai_agent_daily_stats` view adds it up by day. Run these in the Supabase SQL editor.

```sql
-- Cost and volume by day
select day, sum(requests) requests, sum(model_calls) model_calls, sum(cost_usd) usd
from ai_agent_daily_stats group by day order by day desc limit 14;

-- How many messages never paid for a model
select route, count(*) from ai_agent_events
where created_at > now() - interval '7 days' group by route order by 2 desc;

-- Cache hit rate among cacheable questions
select round(100.0 * count(*) filter (where cache_status like 'hit%') / nullif(count(*) filter (where cache_status <> 'skip'), 0), 1) as hit_percent
from ai_agent_events where created_at > now() - interval '7 days';

-- What the guards are catching
select unnest(guard_flags) flag, count(*) from ai_agent_events
where created_at > now() - interval '7 days' group by 1 order by 2 desc;

-- Slowest routes and errors
select route, percentile_cont(0.95) within group (order by latency_ms) p95_ms, count(*) filter (where error is not null) errors
from ai_agent_events where created_at > now() - interval '7 days' group by 1;
```

What to look at:

- **Unsupported value replies rising:** retrieval or the prompt is failing. Look at this first.
- **Retrieval with a low `top_score`:** a topic is missing from the knowledge base.
- **Many `prompt_leak_blocked` flags:** someone is working on an attack.
- **Cost rising faster than requests:** too much is routing to the quality tier.

**Costs are estimates.** Prices are hard-coded in `agent/telemetry.ts` for `gpt-4o-mini`, `gpt-4o` and `gemini-2.5-flash`, and any other model records a blank cost rather than a guess. Check them against the provider's price list, and add the models your secrets actually use.

There is no dashboard screen and no automatic cleanup yet. For cleanup, schedule:

```sql
delete from ai_agent_events where created_at < now() - interval '90 days';
delete from ai_response_cache where expires_at < now();
```

If you later want to read full conversations for quality review, a tool such as Langfuse can add this, but sending health data there needs patient consent and a data agreement first.

## MCP: not needed in the app

**Recommendation: no MCP server at runtime.**

MCP lets an AI tool connect to outside systems it does not already know about. CD4 AI's tools are a small, fixed list inside our own functions, where a direct function call is faster and has fewer things that can fail. It would also add a new network path to health data that has to be secured and audited.

Two MCP servers are worth using **for developers**, on a coding assistant and not in the app:

- **Supabase MCP:** to inspect schema and telemetry. Connect it read-only, and to a staging project, never to production health data.
- **Sentry MCP:** only if you adopt Sentry, to investigate errors.

Revisit this if CD4 AI has to reach outside systems you do not own, such as hospital record systems or pharmacy partners.

## Testing

| Test | Command | What it covers |
|---|---|---|
| Unit | `npm run test:agent` | Small talk, injection, output scrubbing, invented values, routing, cache rules, RBAC, chunking. Free and offline. |
| Live evaluation | `npm run eval:agent` | Real questions against the deployed agent: free routes, injection, identity pressure, scope, language, emergencies, knowledge, cache. Needs `CD4_EMAIL` and `CD4_PASSWORD`, and costs a few paise. |

Run the live evaluation after every prompt, model or knowledge change, and add a case for every bad reply a patient reports.

The database functions were tested once against an in-memory Postgres with pgvector (PGlite), covering hybrid search, RLS and patient scoping. That test is not in the repo.

## Deploying

Order matters: the functions need the new tables and columns.

```
npx supabase db push
npx supabase functions deploy chat-ai medical-report-chat voice-realtime-session voice-realtime-tools analyze-medical-report manage-appointment-payment razorpay-webhook send-appointment-notification
npm run ingest:knowledge
npm run eval:agent
```

## Known limits

- **Voice cannot be filtered before it is spoken.** The app stops a reply as soon as its live transcript shows a vendor name or a prompt leak, but a few words may already have played.
- **Speaking over the assistant (barge-in)** depends on the phone's echo cancellation. A session falls back to closing the mic while the assistant talks if it hears itself twice. `VOICE_BARGE_IN=off` turns it off for everyone without a new build.
- **Medical answers are not grounded yet,** until the medical folder has reviewed content.
- **Chat history comes from the app,** so a patient could forge earlier messages in their own chat. This grants no extra access, since data access depends on the token, but it can confuse that patient's own conversation.
- **Thresholds are starting values.** The retrieval scores and the 0.95 cache threshold have not been tuned on real traffic.
- **No reranker.** If the knowledge base grows large and retrieval quality drops, add one between search and the model.

## Files

| File | Purpose |
|---|---|
| `_shared/agent/persona.ts` | Name, tone, honesty and grounding rules |
| `_shared/agent/smallTalk.ts` | Free replies |
| `_shared/agent/guards.ts` | Injection checks, output scrubbing, value checks |
| `_shared/agent/classifier.ts` | Understands intent, city, specialty and stakes |
| `_shared/agent/verifier.ts` | Checks answers against their source |
| `_shared/agent/router.ts` | Model routing |
| `_shared/agent/knowledge.ts` | Embeddings and hybrid retrieval |
| `_shared/agent/cache.ts` | Exact and semantic cache |
| `_shared/agent/access.ts` | RBAC and the patient's own records |
| `_shared/agent/telemetry.ts` | Event logging and cost estimates |
| `supabase/knowledge/` | Source text for the knowledge base |
| `scripts/ingest-knowledge.mjs` | Loads the knowledge base |
| `supabase/migrations/20261103120000_cd4_ai_agent.sql` | Tables, search functions, stats view |
