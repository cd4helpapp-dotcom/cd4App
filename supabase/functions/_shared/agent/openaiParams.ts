// @ts-nocheck
// GPT-5 and o-series chat models reject max_tokens and a custom temperature. Sending them failed every call, and the code
// quietly fell through to the last model in the list. Their token limit also counts hidden reasoning, hence the extra room.
export const completionLimits = (model: string, maxOutputTokens: number, temperature: number) =>
  /^(gpt-5|o[134])/i.test(String(model))
    ? { max_completion_tokens: maxOutputTokens + 1500, reasoning_effort: "low" }
    : { max_tokens: maxOutputTokens, temperature }
