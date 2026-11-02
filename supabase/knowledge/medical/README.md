# Medical knowledge for CD4 AI

CD4 AI gives this text to patients as fact, so it must come from a trusted source. Keep to one topic per section, and keep sections short, because each one becomes a search result.

## Status of the current files

The 12 files here are short rewordings of WHO fact sheets. **No clinician has reviewed them yet.** Each one lists its source and date. Until reviewed, they carry no `reviewed_by`, and `select source from ai_knowledge_chunks where category = 'medical' and reviewed_on is null` shows what is waiting.

When a doctor signs off a file, add `reviewed_by` and `reviewed_on` to its header and run `npm run ingest:knowledge`. `npm run knowledge:status` lists the files still waiting. Re-check each file against its source at least once a year.

## Adding a file

Good sources: MoHFW, National Health Portal, ICMR guidelines, WHO fact sheets, and CDSCO drug labels. Write it in your own words, as these sources are copyrighted. Do not have an AI write medical facts from memory.

```
---
title: Dengue
category: medical
audience: all
reference: WHO fact sheet, https://www.who.int/...
source_date: 2025-08-21
reviewed_by: Dr. Full Name
reviewed_on: 2026-12-01
---

## Dengue symptoms
Short section with one topic.
```

The first part of `reference`, before the comma, is what the patient sees as the source, so "WHO fact sheet" reads as "Source: WHO".
