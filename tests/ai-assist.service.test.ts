import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { redactPII, redactObject } from '../server/utils/redact.js';

describe('redactPII / redactObject', () => {
  it('redacts emails, IPv4 addresses, and phone-shaped digit runs', () => {
    const text = 'Contact alice@example.com from 203.0.113.42, call 555-123-4567';
    const redacted = redactPII(text);
    expect(redacted).not.toContain('alice@example.com');
    expect(redacted).not.toContain('203.0.113.42');
    expect(redacted).toContain('[EMAIL]');
    expect(redacted).toContain('[IP]');
  });

  it('deep-redacts nested objects/arrays but leaves Date instances and opaque IDs intact', () => {
    const now = new Date();
    const input = {
      userId: 'a1b2c3d4-uuid-not-pii',
      createdAt: now,
      notes: ['reach me at bob@example.com', 'no pii here'],
    };
    const out = redactObject(input);
    expect(out.userId).toBe('a1b2c3d4-uuid-not-pii');
    expect(out.createdAt).toBe(now);
    expect(out.notes[0]).toContain('[EMAIL]');
    expect(out.notes[1]).toBe('no pii here');
  });
});

describe('ai-assist.service', () => {
  const messagesCreate = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    messagesCreate.mockReset();
    vi.doMock('@anthropic-ai/sdk', () => ({
      default: vi.fn().mockImplementation(function (this: any) {
        this.messages = { create: messagesCreate };
      }),
    }));
    // ai-assist.service.js composes isAiAssistEnabled() with feature.service.js's isEnabled(),
    // which imports event-bus.service.js — a real re-import on every vi.resetModules() would
    // re-run that module's top-level prom-client Counter registration and collide with the
    // still-registered metrics from the previous reset (prom-client's default registry is a
    // process-wide singleton, not cleared by resetModules). Stub feature.service.js instead —
    // this suite only cares about the ANTHROPIC_API_KEY-driven behavior, not the flag system.
    vi.doMock('../server/services/feature.service.js', () => ({
      isEnabled: () => true,
    }));
  });

  afterEach(() => {
    vi.doUnmock('@anthropic-ai/sdk');
    vi.doUnmock('../server/config.js');
    vi.doUnmock('../server/services/feature.service.js');
  });

  it('isAiAssistEnabled() is false when ANTHROPIC_API_KEY is unset', async () => {
    vi.doMock('../server/config.js', async (importOriginal) => { const actual = await importOriginal() as any; return { ...actual, config: { ...actual.config, ANTHROPIC_API_KEY: undefined } }; });
    const svc = await import('../server/services/ai-assist.service.js');
    expect(svc.isAiAssistEnabled()).toBe(false);
  });

  it('draftRiskPolicy throws AiAssistDisabledError when no API key is configured, without ever calling the model', async () => {
    vi.doMock('../server/config.js', async (importOriginal) => { const actual = await importOriginal() as any; return { ...actual, config: { ...actual.config, ANTHROPIC_API_KEY: undefined } }; });
    const svc = await import('../server/services/ai-assist.service.js');

    await expect(svc.draftRiskPolicy('block logins from Russia')).rejects.toThrow(svc.AiAssistDisabledError);
    expect(messagesCreate).not.toHaveBeenCalled();
  });

  it('draftRiskPolicy extracts the JSON object even when the model wraps it in prose', async () => {
    vi.doMock('../server/config.js', async (importOriginal) => { const actual = await importOriginal() as any; return { ...actual, config: { ...actual.config, ANTHROPIC_API_KEY: 'test-key' } }; });
    messagesCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'Here is the draft:\n{"name":"High risk block","minScore":80,"maxScore":100,"action":"deny","rationale":"test"}\nLet me know if you want changes.' }],
    });
    const svc = await import('../server/services/ai-assist.service.js');

    const draft = await svc.draftRiskPolicy('block anything above 80');
    expect(draft).toEqual({ name: 'High risk block', minScore: 80, maxScore: 100, action: 'deny', rationale: 'test' });
  });

  it('draftRiskPolicy rejects a model response missing required fields', async () => {
    vi.doMock('../server/config.js', async (importOriginal) => { const actual = await importOriginal() as any; return { ...actual, config: { ...actual.config, ANTHROPIC_API_KEY: 'test-key' } }; });
    messagesCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: '{"minScore":80,"maxScore":100}' }], // missing name/action
    });
    const svc = await import('../server/services/ai-assist.service.js');

    await expect(svc.draftRiskPolicy('block anything above 80')).rejects.toThrow(/missing required policy fields/);
  });

  it('draftRiskPolicy rejects a non-JSON model response instead of silently returning garbage', async () => {
    vi.doMock('../server/config.js', async (importOriginal) => { const actual = await importOriginal() as any; return { ...actual, config: { ...actual.config, ANTHROPIC_API_KEY: 'test-key' } }; });
    messagesCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'Sorry, I cannot help with that.' }],
    });
    const svc = await import('../server/services/ai-assist.service.js');

    await expect(svc.draftRiskPolicy('do something vague')).rejects.toThrow(/did not return valid JSON/);
  });

  it('draftRiskPolicy sends a PII-redacted prompt to the model, never the raw instruction', async () => {
    vi.doMock('../server/config.js', async (importOriginal) => { const actual = await importOriginal() as any; return { ...actual, config: { ...actual.config, ANTHROPIC_API_KEY: 'test-key' } }; });
    messagesCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: '{"name":"x","minScore":0,"maxScore":10,"action":"allow","rationale":"x"}' }],
    });
    const svc = await import('../server/services/ai-assist.service.js');

    await svc.draftRiskPolicy('flag logins reported by admin@example.com');

    const sentPrompt = messagesCreate.mock.calls[0][0].messages[0].content as string;
    expect(sentPrompt).not.toContain('admin@example.com');
    expect(sentPrompt).toContain('[EMAIL]');
  });
});
