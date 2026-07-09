import { describe, it, expect } from 'vitest';
import { parseExecutionOutput, mapOutcome } from '../src/index';

describe('Event-line parsing', () => {
  it('should parse valid @@EV@@ lines', () => {
    const output = `@@EV@@ {"type":"log","msg":"hello","v":1}\n@@RESULT@@ {"exit_code":0,"wall_ms":100,"killed_by":null}`;
    const { events, result } = parseExecutionOutput(output);
    
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ type: 'log', msg: 'hello', v: 1 });
    expect(result.exit_code).toBe(0);
  });

  it('should handle malformed JSON after @@EV@@', () => {
    const output = `@@EV@@ not-valid-json\n@@RESULT@@ {"exit_code":0,"wall_ms":100,"killed_by":null}`;
    const { events } = parseExecutionOutput(output);
    
    expect(events).toHaveLength(0);
  });

  it('should parse interleaved stdout and events', () => {
    const output = `Some stdout line\n@@EV@@ {"type":"log","msg":"event1","v":1}\nMore stdout\n@@EV@@ {"type":"stat_set","name":"hp","value":100,"v":1}\n@@RESULT@@ {"exit_code":0,"wall_ms":50,"killed_by":null}`;
    const { events } = parseExecutionOutput(output);
    
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe('log');
    expect(events[1].type).toBe('stat_set');
  });

  it('should parse result line with killed_by field', () => {
    const output = `@@RESULT@@ {"exit_code":1,"wall_ms":2000,"killed_by":"wall_timeout"}`;
    const { result } = parseExecutionOutput(output);
    
    expect(result.exit_code).toBe(1);
    expect(result.killed_by).toBe('wall_timeout');
  });

  it('should handle missing @@RESULT@@ line', () => {
    const output = `@@EV@@ {"type":"log","msg":"test","v":1}\nSome output`;
    const { result } = parseExecutionOutput(output);
    
    expect(result.exit_code).toBe(0);
    expect(result.killed_by).toBeNull();
  });
});

describe('Result mapping', () => {
  it('should map clean exit to success', () => {
    const outcome = mapOutcome({ exit_code: 0, wall_ms: 100, cpu_ms: 50, killed_by: null });
    
    expect(outcome.success).toBe(true);
    expect(outcome.messages).toEqual([]);
  });

  it('should map wall_timeout to failure', () => {
    const outcome = mapOutcome({ exit_code: 0, wall_ms: 3000, cpu_ms: 50, killed_by: 'wall_timeout' });
    
    expect(outcome.success).toBe(false);
    expect(outcome.error).toContain('rages beyond control');
  });

  it('should map cpu_timeout to failure', () => {
    const outcome = mapOutcome({ exit_code: 0, wall_ms: 3000, cpu_ms: 2000, killed_by: 'cpu_timeout' });
    
    expect(outcome.success).toBe(false);
    expect(outcome.error).toContain('rages beyond control');
  });

  it('should map memory to failure', () => {
    const outcome = mapOutcome({ exit_code: 137, wall_ms: 500, cpu_ms: 100, killed_by: 'memory' });
    
    expect(outcome.success).toBe(false);
    expect(outcome.error).toContain('devoured all the aether');
  });

  it('should map output_cap to failure', () => {
    const outcome = mapOutcome({ exit_code: 137, wall_ms: 500, cpu_ms: 100, killed_by: 'output_cap' });
    
    expect(outcome.success).toBe(false);
    expect(outcome.error).toContain('babbles endlessly');
  });

  it('should map nonzero exit code to failure', () => {
    const outcome = mapOutcome({ exit_code: 1, wall_ms: 50, cpu_ms: 10, killed_by: null });
    
    expect(outcome.success).toBe(false);
    expect(outcome.error).toContain('collapsed before completing');
  });

  it('should map SIGSEGV to memory error', () => {
    const outcome = mapOutcome({ exit_code: 139, wall_ms: 500, cpu_ms: 100, killed_by: 'memory' });
    
    expect(outcome.success).toBe(false);
    expect(outcome.error).toContain('devoured all the aether');
  });
});
