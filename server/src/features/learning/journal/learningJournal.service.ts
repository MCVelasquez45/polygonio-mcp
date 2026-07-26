import { writeStructuredLog } from '../../../shared/logging/safeLogging';

export function logLearningEvent(event: string, context: Record<string, unknown> = {}): void {
  writeStructuredLog({
    component: 'server',
    module: 'learning-intelligence',
    event,
    severity: 'info',
    context,
  });
}
