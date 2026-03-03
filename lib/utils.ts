/**
 * Strips markdown JSON fences from LLM output.
 * Handles: ```json ... ```, ``` ... ```, and bare text.
 */
export function stripJsonFences(text: string): string {
  return text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
}
